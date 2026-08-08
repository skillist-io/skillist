import fs from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const WEB_URL = process.env.SMOKE_WEB_URL ?? "https://skillist.io";
// Authenticated flows live on the console app now.
const CONSOLE_URL = process.env.SMOKE_CONSOLE_URL ?? "https://console.skillist.io";
const AUTH_STATE = "tests/e2e/.auth/user.json";

const hasAuthState = Boolean(process.env.E2E_AUTH_STATE_B64) || fs.existsSync(AUTH_STATE);

// Without auth state the `authenticated` project below is simply not registered,
// so the run passes having exercised zero authenticated flows — indistinguishable
// from a run that checked them all. Locally that is fine; contributors without
// production credentials should not be blocked. In CI it means the console is
// unverified while the job reports success, so fail instead of going quiet.
if (process.env.CI && !hasAuthState) {
  throw new Error(
    "E2E_AUTH_STATE_B64 is not set — the `authenticated` Playwright project would not be registered and this run would pass without testing a single authenticated flow. Add it as a REPOSITORY secret.",
  );
}

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
