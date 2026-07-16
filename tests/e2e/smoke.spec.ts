import { expect, test } from "@playwright/test";

test("homepage shows hero and registry MCP section", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Realtime Agent Skills" })).toBeVisible();
  await expect(page.getByText("Registry MCP")).toBeVisible();
  await expect(page.getByText("registry_search")).toBeVisible();
});

test("registry lists skills", async ({ page }) => {
  await page.goto("/registry");
  await expect(page.getByRole("heading", { name: "Public Registry" })).toBeVisible();
  await expect(page.locator("a[href*='/registry/skillist/']").first()).toBeVisible();
});

test("login guard redirects dashboard to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("inventory route serves app shell", async ({ page }) => {
  await page.goto("/inventory");
  await expect(page.locator("#root")).toBeVisible();
});
