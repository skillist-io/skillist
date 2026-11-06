import { expect, test } from "@playwright/test";

test.use({ storageState: "tests/e2e/.auth/user.json" });

test("saved auth session can load dashboard", async ({ page }) => {
  await page.goto("/dashboard", { waitUntil: "networkidle" });
  await expect(page.getByText("What needs you, and the state of every skill")).toBeVisible({
    timeout: 15_000,
  });
});
