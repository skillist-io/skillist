import { defineConfig, devices } from "@playwright/test";

const WEB_URL = process.env.SMOKE_WEB_URL ?? "https://skillist.dev";

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  retries: 1,
  use: {
    baseURL: WEB_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
