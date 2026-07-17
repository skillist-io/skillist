import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { hasAuthState } from "./global-setup";

async function skipIfSignedOut(page: Page, testInfo: TestInfo, path = "/dashboard") {
  await page.goto(path, { waitUntil: "networkidle" });
  const onLogin =
    new URL(page.url()).pathname === "/login" ||
    (await page.getByRole("heading", { name: "Sign in to Skillist" }).isVisible());
  if (onLogin) {
    testInfo.skip(
      true,
      "Auth state expired — run: pnpm exec playwright open --save-storage=tests/e2e/.auth/user.json https://skillist.dev/login",
    );
  }
}

async function ensureExplorerOpen(page: Page) {
  const privateOnly = page.getByText("Private only");
  if (!(await privateOnly.isVisible())) {
    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  }
  await expect(privateOnly).toBeVisible();
}

test.describe("signed-in flows", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    if (!(await hasAuthState())) {
      testInfo.skip(
        true,
        "Set E2E_AUTH_STATE_B64 or run scripts/export-e2e-auth-state.sh after signing in locally",
      );
    }
    await skipIfSignedOut(page, testInfo);
  });

  test("dashboard loads for authenticated user", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Manage organizations and skills")).toBeVisible();
  });

  test("inventory page loads for authenticated user", async ({ page }, testInfo) => {
    await skipIfSignedOut(page, testInfo, "/inventory");
    await expect(page.getByRole("heading", { name: "Skill inventory" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Load example" })).toBeVisible();
  });

  test("inventory example scan resolves skillist registry link", async ({ page }, testInfo) => {
    await skipIfSignedOut(page, testInfo, "/inventory");
    await page.getByRole("button", { name: "Load example" }).click();
    await expect(page.getByText("skillist/cloudflare-deploy")).toBeVisible();
  });

  test("signed-in session authorizes apex /run via skillist.dev proxy", async ({ page }) => {
    const res = await page.request.post("/skillist/cloudflare-deploy/run", {
      headers: { "Content-Type": "application/json" },
      data: { scriptPath: "scripts/preflight.sh" },
    });

    expect(res.status()).not.toBe(401);
  });

  test("dashboard shows org/skill explorer with private-only filter", async ({ page }) => {
    await ensureExplorerOpen(page);

    await expect(page.getByPlaceholder("Filter orgs and skills...")).toBeVisible();

    const publicBadges = page.getByText("public", { exact: true });
    const hadPublic = (await publicBadges.count()) > 0;

    await page.locator("#sidebar-private-only").click();

    if (hadPublic) {
      await expect(publicBadges).toHaveCount(0);
    } else {
      await expect(page.getByText("No private skills match your filters.")).toBeVisible();
    }
  });

  test("inventory shows sidebar explorer toggle", async ({ page }, testInfo) => {
    await skipIfSignedOut(page, testInfo, "/inventory");
    await expect(page.getByRole("heading", { name: "Skill inventory" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Toggle Sidebar" })).toBeVisible();
  });

  test("sidebar open state persists after refresh on dashboard", async ({ page }) => {
    await ensureExplorerOpen(page);

    const toggle = page.getByRole("button", { name: "Toggle Sidebar" });
    await toggle.click();
    await expect(page.getByText("Private only")).toBeHidden();

    await page.reload();
    await expect(page.getByText("Private only")).toBeHidden();

    await toggle.click();
    await expect(page.getByText("Private only")).toBeVisible();
  });
});
