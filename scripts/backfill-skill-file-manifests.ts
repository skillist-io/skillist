/**
 * Recomputes `skill_files` sizes and digests from the bytes in R2.
 *
 * Rows written before #162 measured string length and hashed the base64 text of
 * binary assets, so MCP hosts would reject those files. See
 * apps/api/src/lib/skill-file-backfill.ts for what it does and doesn't change.
 *
 *   pnpm backfill:skill-files                  # production, dry run (reads only)
 *   pnpm backfill:skill-files --apply          # production, writes repairs
 *   pnpm backfill:skill-files --local          # local D1 and R2, dry run
 *
 * Requires: wrangler logged in or CLOUDFLARE_API_TOKEN set.
 */
import { backfillSkillFiles } from "../apps/api/src/lib/skill-file-backfill";
import { openDb } from "./lib/open-db";

const SAMPLE_SIZE = 20;

const local = process.argv.includes("--local");
const apply = process.argv.includes("--apply");

async function main() {
  // Printed first so a wrong target is visible before anything is read or written.
  const bucketName = local ? "skillist-skills-preview" : "skillist-skills";
  console.log(`Target: ${local ? "LOCAL" : "PRODUCTION"} D1 "skillist", R2 "${bucketName}"`);
  console.log(`Mode:   ${apply ? "APPLY (writes repairs)" : "dry run (no writes)"}\n`);

  const { db, bucket, dispose } = await openDb({ local });
  try {
    const report = await backfillSkillFiles(db, bucket, { apply });

    for (const repair of report.repairs.slice(0, SAMPLE_SIZE)) {
      const { before, after } = repair;
      const digest = before.sha256 === after.sha256 ? "digest same" : "digest differs";
      console.log(
        `  ${repair.versionId} ${repair.path}: ${before.size} -> ${after.size} bytes, ${digest}`,
      );
    }
    if (report.repairs.length > SAMPLE_SIZE) {
      console.log(`  ...and ${report.repairs.length - SAMPLE_SIZE} more`);
    }
    for (const row of report.missing) {
      console.log(`  MISSING ${row.key}`);
    }

    console.log(`\nScanned:  ${report.scanned}`);
    console.log(`Correct:  ${report.correct}`);
    console.log(`${apply ? "Repaired" : "To repair"}: ${report.repairs.length}`);
    console.log(`Missing:  ${report.missing.length} (no R2 object, left unchanged)`);
    console.log(`Skipped:  ${report.skipped} (changed during the run, re-run to retry)`);
    if (!apply && report.repairs.length > 0) {
      console.log("\nNothing was written. Re-run with --apply to write these repairs.");
    }
  } finally {
    await dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
