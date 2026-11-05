/**
 * One-time move of production data from Neon to D1. Read-only on Neon.
 *
 * Run these in order, BEFORE merging the D1 change, so the deployed Worker never
 * sees an empty database. CI's own migration step then has nothing left to do.
 *
 *   # 1. Export. Refuses if Neon and the D1 schema disagree.
 *   NEON_URL=... pnpm exec tsx scripts/migrate-neon-to-d1.ts export ./d1-import
 *
 *   # 2. Create the tables. The one time a migration is applied by hand.
 *   cd apps/api && pnpm exec wrangler d1 migrations apply skillist --remote \
 *     --config wrangler.production.jsonc
 *
 *   # 3. Load. Fails on existing rows rather than replacing them.
 *   pnpm exec wrangler d1 execute skillist --remote \
 *     --config wrangler.production.jsonc --file ../../d1-import/data.sql
 *
 *   # 4. Verify row counts and foreign keys. Add --local after a rehearsal load.
 *   cd ../.. && pnpm exec tsx scripts/migrate-neon-to-d1.ts verify ./d1-import
 *
 * The output holds real user data. d1-import/ is gitignored; delete it after.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  exportTables,
  findSchemaDrift,
  insertStatement,
  loadScript,
  oversizedStatements,
} from "../packages/db/src/neon-export";

const API_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "..", "apps", "api");

async function runExport(outDir: string) {
  const url = process.env.NEON_URL;
  if (!url) throw new Error("NEON_URL is required");
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  try {
    const tables = exportTables();
    const { rows: columnRows } = await client.query<{ table_name: string; column_name: string }>(
      `SELECT c.table_name, c.column_name FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'`,
    );
    const neon: Record<string, string[]> = {};
    for (const { table_name, column_name } of columnRows) {
      neon[table_name] ??= [];
      neon[table_name].push(column_name);
    }

    const drift = findSchemaDrift(tables, neon);
    if (drift.length > 0) {
      throw new Error(`Refusing to export, schemas differ:\n  ${drift.join("\n  ")}`);
    }

    const statements: string[] = [];
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const names = table.columns.map((c) => `"${c.name}"`).join(", ");
      const { rows } = await client.query(`SELECT ${names} FROM "${table.name}"`);
      counts[table.name] = rows.length;
      for (const row of rows) statements.push(insertStatement(table, row));
      console.log(`${table.name}: ${rows.length}`);
    }

    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "data.sql"), loadScript(statements));
    writeFileSync(join(outDir, "counts.json"), `${JSON.stringify(counts, null, 2)}\n`);
    const oversized = oversizedStatements(statements);
    if (oversized.length > 0) {
      const largest = Math.max(...oversized);
      console.warn(
        `\nWARNING: ${oversized.length} statements near D1's limit, largest ${largest} B`,
      );
    }
    console.log(`\nWrote ${join(outDir, "data.sql")}`);
  } finally {
    await client.end();
  }
}

/** `--local` targets the local D1, for rehearsing the load before the real one. */
const LOCAL = process.argv.includes("--local");

function d1Query(sql: string): Record<string, unknown>[] {
  const target = LOCAL ? ["--local"] : ["--remote", "--config", "wrangler.production.jsonc"];
  const out = execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", "skillist", ...target, "--json", "--command", sql],
    { cwd: API_DIR, encoding: "utf8" },
  );
  return (JSON.parse(out) as { results: Record<string, unknown>[] }[])[0]?.results ?? [];
}

function runVerify(outDir: string) {
  const expected = JSON.parse(readFileSync(join(outDir, "counts.json"), "utf8")) as Record<
    string,
    number
  >;
  // One row of scalar subqueries: D1 caps compound SELECTs well below one branch
  // per table, so a UNION ALL across the schema is rejected.
  const query = `SELECT ${Object.keys(expected)
    .map((name) => `(SELECT count(*) FROM ${name}) AS ${name}`)
    .join(", ")}`;
  const actual = new Map(Object.entries(d1Query(query)[0] ?? {}));

  let failed = false;
  for (const [name, count] of Object.entries(expected)) {
    if (actual.get(name) !== count) {
      failed = true;
      console.error(`MISMATCH ${name}: Neon ${count}, D1 ${actual.get(name)}`);
    }
  }
  const orphans = d1Query("PRAGMA foreign_key_check");
  if (orphans.length > 0) {
    failed = true;
    console.error(`${orphans.length} foreign key violations`, orphans.slice(0, 5));
  }
  if (failed) process.exit(1);
  console.log(`OK: ${Object.keys(expected).length} tables match, no foreign key violations`);
}

async function main() {
  const [command, outDir = "./d1-import"] = process.argv.slice(2).filter((a) => a !== "--local");
  if (command === "export") await runExport(outDir);
  else if (command === "verify") runVerify(outDir);
  else throw new Error("Usage: migrate-neon-to-d1.ts export|verify [dir]");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
