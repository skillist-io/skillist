import fs from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const WEB_URL = process.env.SMOKE_WEB_URL ?? "https://skillist.io";
const AUTH_STATE = "tests/e2e/.auth/user.json";

const hasAuthState = Boolean(process.env.E2E_AUTH_STATE_B64) || fs.existsSync(AUTH_STATE);

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
              storageState: AUTH_STATE,
            },
          },
        ]
      : []),
  ],
});
