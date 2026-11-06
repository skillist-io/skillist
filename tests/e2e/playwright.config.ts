import fs from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const WEB_URL = process.env.SMOKE_WEB_URL ?? "https://skillist.dev";
// Authenticated flows live on the console app now.
const CONSOLE_URL = process.env.SMOKE_CONSOLE_URL ?? "https://console.skillist.dev";
const AUTH_STATE = "tests/e2e/.auth/user.json";

const hasAuthState = Boolean(process.env.E2E_AUTH_STATE_B64) || fs.existsSync(AUTH_STATE);

// Without auth state the `authenticated` project below is simply not registered,
// so those flows don't run. global-setup.ts raises a CI warning when that happens,
// because a saved session expires after 7 days and can't be a hard requirement.

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  retries: 1,
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: WEB_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      testMatch: /smoke\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    ...(hasAuthState
      ? [
          {
            name: "authenticated",
            testMatch: /authenticated\.spec\.ts|auth-health\.spec\.ts/,
            use: {
              ...devices["Desktop Chrome"],
              baseURL: CONSOLE_URL,
              storageState: AUTH_STATE,
            },
          },
        ]
      : []),
  ],
});
