// Creates the Postgres extensions the schema depends on, before drizzle-kit
// applies migrations.
//
// Why this exists: schema.ts declares GIN trigram indexes (registry_*_trgm_idx)
// that require pg_trgm, but drizzle-kit never emits `CREATE EXTENSION`. The
// extension therefore had to be created by hand, and that step was written down
// nowhere — so applying the migration chain to a fresh database (a new Neon
// branch, a preview environment, a CI run) failed at the first trigram index.
//
// Idempotent: safe to run against a database that already has the extension.
// Neon branches inherit extensions from their parent, so this is usually a
// no-op — it matters for branches created from a pre-extension snapshot.

import { config } from "dotenv";
import pg from "pg";

// Mirrors drizzle.config.ts: cwd is packages/db, the .env lives at the repo
// root, and dotenv does not override an already-set DATABASE_URL (so CI and
// production, which set it directly, are unaffected).
config({ path: "../../.env", quiet: true });

const REQUIRED_EXTENSIONS = ["pg_trgm"];

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set — cannot ensure extensions.");
  process.exit(1);
}

const client = new pg.Client({ connectionString });

try {
  await client.connect();
  for (const extension of REQUIRED_EXTENSIONS) {
    // Identifiers are from the hardcoded list above, never user input.
    await client.query(`CREATE EXTENSION IF NOT EXISTS ${extension};`);
    console.log(`ensured extension: ${extension}`);
  }
} catch (err) {
  console.error(`Failed to ensure extensions: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
