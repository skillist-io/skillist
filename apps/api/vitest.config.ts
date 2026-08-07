import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * Optional test database.
 *
 * Most of the suite runs without one, but anything behind authMiddleware opens
 * a Postgres connection on every request, so those tests could only ever be
 * skipped. Set TEST_DATABASE_URL and they run for real:
 *
 *   NEON_PROJECT_ID=<id> pnpm db:up          # ephemeral Neon branch
 *   pnpm db:migrate:local
 *   TEST_DATABASE_URL="postgresql://neon:npg@localhost:5432/neondb?sslmode=no-verify" pnpm test
 *
 * Wrangler backs the Hyperdrive binding in local mode from this env var, which
 * is why it is set here rather than in wrangler.jsonc — the checked-in config
 * must not carry a real connection string.
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "";
if (testDatabaseUrl) {
  process.env.WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE = testDatabaseUrl;
  process.env.WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE_CACHE_DISABLED =
    testDatabaseUrl;
}

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      remoteBindings: false,
      miniflare: {
        bindings: {
          // INTEGRATION_DB is the flag the DB-dependent suites already gate on
          // (routes/projects.test.ts, lib/agent/memory.test.ts). Setting it here
          // from TEST_DATABASE_URL means one env var lights up every such suite,
          // rather than each inventing its own switch.
          ...(testDatabaseUrl ? { INTEGRATION_DB: "1" } : {}),
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
    /**
     * Closing a Postgres connection outside a request's I/O context makes
     * workerd report "Stream was cancelled" as the socket tears down. The work
     * has already completed — the tests pass — but the stray rejection would
     * fail the run.
     *
     * Narrowly matched on purpose: every other unhandled error still fails,
     * so this cannot quietly swallow a real one.
     */
    onUnhandledError(error) {
      if (error.message?.includes("Stream was cancelled")) return false;
      return undefined;
    },
  },
});
