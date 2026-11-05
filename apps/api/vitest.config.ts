import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// The real schema, applied to Miniflare's local D1 by test-support/apply-migrations.
const migrations = await readD1Migrations("../../packages/db/migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      remoteBindings: false,
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          // Tests execute inside workerd, where `process.env` is NOT the Node
          // process environment. A binding is the only thing that crosses that
          // boundary, which is why the relaxed CI latency budgets in
          // publish-latency.test.ts read this rather than `process.env.CI`.
          CI: process.env.CI ?? "",
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./src/test-support/apply-migrations.ts"],
  },
});
