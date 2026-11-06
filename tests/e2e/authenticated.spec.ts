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

const explorerFilter = (page: Page) => page.getByPlaceholder("Filter orgs and skills...");

/** The panel only, so a skill or "public" on the page itself can't satisfy a check. */
const explorer = (page: Page) =>
  page.locator('[data-slot="sidebar-content"]').filter({ has: page.getByText("Skills") });

async function ensureExplorerOpen(page: Page) {
  if (!(await explorerFilter(page).isVisible())) {
    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  }
  await expect(explorerFilter(page)).toBeVisible();
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
    await expect(page.getByText("What needs you, and the state of every skill")).toBeVisible();
  });

  test("inventory page loads for authenticated user", async ({ page }, testInfo) => {
    await skipIfSignedOut(page, testInfo, "/inventory");
    await expect(page.getByRole("heading", { name: "Skill inventory" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Load example" })).toBeVisible();
  });

  test("inventory example scan resolves skillist registry link", async ({ page }, testInfo) => {
    await skipIfSignedOut(page, testInfo, "/inventory");
    await page.getByRole("button", { name: "Load example" }).click({ timeout: 10_000 });
    // The example lands in the textarea's value, which getByText can't see.
    await expect(page.getByLabel("Scan payload JSON")).toHaveValue(/skillist\/cloudflare-deploy/);
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

    const publicBadges = explorer(page).getByText("public", { exact: true });
    const hadPublic = (await publicBadges.count()) > 0;

    await page.getByRole("button", { name: "Show only private skills" }).click();

    if (hadPublic) {
      await expect(publicBadges).toHaveCount(0);
    } else {
      await expect(page.getByText("No private skills match your filters.")).toBeVisible();
    }
  });

  test("explorer filter finds a skill by name and says when nothing matches", async ({
    page,
  }, testInfo) => {
    await ensureExplorerOpen(page);
    const skillLink = explorer(page).locator('a[href*="/skills/"]').first();
    if ((await skillLink.count()) === 0) {
      testInfo.skip(true, "No skills in this account to filter for");
    }
    const repo = (await skillLink.getAttribute("href"))?.split("/").pop() ?? "";

    await explorerFilter(page).fill(repo);
    await expect(explorer(page).locator(`a[href$="/skills/${repo}"]`).first()).toBeVisible();

    await explorerFilter(page).fill("no-skill-is-called-this");
    await expect(page.getByText("No skills match your filters.")).toBeVisible();
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
    await expect(explorerFilter(page)).toBeHidden();

    await page.reload();
    await expect(explorerFilter(page)).toBeHidden();

    await toggle.click();
    await expect(explorerFilter(page)).toBeVisible();
  });

  test("skill bundle editor renders tree, tabs, and live validation", async ({
    page,
  }, testInfo) => {
    await ensureExplorerOpen(page);
    const skillLink = page.locator('a[href*="/skills/"]').first();
    if ((await skillLink.count()) === 0) {
      testInfo.skip(true, "No skills in this account to open the editor with");
    }
    await skillLink.click();
    await page.waitForURL(/\/orgs\/.+\/skills\/.+/);

    const editorHeading = page.getByText("Skill bundle editor");
    if (!(await editorHeading.isVisible())) {
      testInfo.skip(true, "Bundle editor not deployed to this environment yet");
    }

    await expect(page.getByText("Files", { exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Source" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Frontmatter" })).toBeVisible();

    const source = page.getByLabel("SKILL.md source");
    await expect(source).toBeVisible();
    await source.focus();
    await page.keyboard.press("End");
    await page.keyboard.type("x");
    await expect(page.getByTitle("Unsaved changes")).toBeVisible();

    await page.getByRole("tab", { name: "Frontmatter" }).click();
    await expect(page.getByLabel("name", { exact: true })).toBeVisible();
    await expect(page.getByText("agentskills.io conformance, checked as you type")).toBeVisible();
  });

  test.describe("on a phone-sized screen", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("sheet carries the explorer and closes after navigating", async ({ page }) => {
      const sheet = page.locator('[data-mobile="true"]');
      await page.getByRole("button", { name: "Toggle Sidebar" }).click();

      await expect(sheet.getByPlaceholder("Filter orgs and skills...")).toBeVisible();

      await sheet.getByRole("link", { name: "Inventory" }).click();
      await expect(page).toHaveURL(/\/inventory/);
      await expect(sheet).toBeHidden();
    });
  });

  test("logout from sidebar redirects to login and clears session", async ({ page }) => {
    await expect(page.getByText("What needs you, and the state of every skill")).toBeVisible();

    await page.locator('[data-slot="sidebar-footer"] [data-sidebar="menu-button"]').click();
    await page.getByRole("menuitem", { name: "Log out" }).click();

    await expect(page).toHaveURL(/\/login(\?.*)?$/);
    await expect(page.getByRole("heading", { name: "Sign in to Skillist" })).toBeVisible();

    await page.goto("/dashboard", { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/login(\?.*)?$/);
  });
});
