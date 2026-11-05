import { applyD1Migrations, env } from "cloudflare:test";
import { vi } from "vitest";

const { DB, TEST_MIGRATIONS } = env as unknown as {
  DB: D1Database;
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
};

// Idempotent: applied migrations are skipped, so this is safe in every test file.
await applyD1Migrations(DB, TEST_MIGRATIONS);

// Importing `cloudflare:test` loads the worker's module graph. Left cached, those
// modules keep their real imports and a test's `vi.mock` silently stops applying.
vi.resetModules();
