import { expect, test } from "@playwright/test";
import { hasAuthState } from "./global-setup";

test.describe("signed-in flows", () => {
  test.beforeEach(async (_context, testInfo) => {
    if (!(await hasAuthState())) {
      testInfo.skip(
        true,
        "Set E2E_AUTH_STATE_B64 or run scripts/export-e2e-auth-state.sh after signing in locally",
      );
    }
  });

  test("dashboard loads for authenticated user", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Manage organizations and skills")).toBeVisible();
  });

  test("inventory page loads for authenticated user", async ({ page }) => {
    await page.goto("/inventory");
    await expect(page).toHaveURL(/\/inventory/);
    await expect(page.getByRole("heading", { name: "Skill inventory" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Load example" })).toBeVisible();
  });

  test("inventory example scan resolves skillist registry link", async ({ page }) => {
    await page.goto("/inventory");
    await page.getByRole("button", { name: "Load example" }).click();
    await expect(page.getByText("skillist/cloudflare-deploy")).toBeVisible();
  });
});
