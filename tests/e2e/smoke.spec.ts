import { expect, test } from "@playwright/test";

test("homepage shows hero and connect section", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "The realtime registry for Agent Skills" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connect your agent" })).toBeVisible();
  await expect(page.getByText("Available for these agents")).toBeVisible();
});

test("registry lists skills", async ({ page }) => {
  await page.goto("/registry");
  await expect(page.getByRole("heading", { name: "Public Registry" })).toBeVisible();
  await expect(page.locator("a[href*='/skillist/']").first()).toBeVisible();
});

test("registry shows retry when API fails then recovers", async ({ page }) => {
  let listFailures = 0;
  let allowRegistryList = false;

  await page.route(/\/v1\/registry(\?|$)/, async (route) => {
    const url = route.request().url();
    if (url.includes("/v1/registry/facets")) {
      await route.continue();
      return;
    }

    listFailures += 1;
    if (!allowRegistryList && listFailures <= 2) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Service unavailable" }),
      });
      return;
    }

    await route.continue();
  });

  await page.goto("/registry");
  await expect(page.getByText("Could not load registry")).toBeVisible({
    timeout: 10_000,
  });

  allowRegistryList = true;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.locator("a[href*='/skillist/']").first()).toBeVisible({
    timeout: 15_000,
  });
});

test("login guard redirects dashboard to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("inventory redirects to login when signed out", async ({ page }) => {
  await page.goto("/inventory");
  await expect(page).toHaveURL(/\/login/);
});
