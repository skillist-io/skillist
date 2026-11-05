import { applyD1Migrations, env } from "cloudflare:test";

const { DB, TEST_MIGRATIONS } = env as unknown as {
  DB: D1Database;
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
};

// Idempotent: applied migrations are skipped, so this is safe in every test file.
await applyD1Migrations(DB, TEST_MIGRATIONS);
