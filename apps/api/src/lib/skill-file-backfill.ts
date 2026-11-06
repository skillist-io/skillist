import { skillFiles, skillVersions } from "@skillist/db/schema";
import { and, asc, eq, gt } from "drizzle-orm";
import type { WorkerDb } from "./db";

const PAGE_SIZE = 200;
const CONCURRENT_READS = 8;

export type SkillFileRepair = {
  id: string;
  versionId: string;
  path: string;
  before: { sha256: string; size: number };
  after: { sha256: string; size: number };
};

export type SkillFileBackfillReport = {
  scanned: number;
  correct: number;
  repairs: SkillFileRepair[];
  /** Rows with no R2 object. Reported, never changed: there is nothing true to write. */
  missing: { id: string; versionId: string; path: string; key: string }[];
  /** Rows a concurrent writer changed between the read and the update. */
  skipped: number;
};

async function measure(bytes: ArrayBuffer) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return {
    sha256: [...hash].map((b) => b.toString(16).padStart(2, "0")).join(""),
    size: bytes.byteLength,
  };
}

/**
 * Makes `skill_files` describe the bytes R2 actually holds, for rows written
 * before sizes and digests were measured on stored bytes.
 *
 * It hashes each object as stored rather than re-deriving from bundle text, so
 * it needs no assumption about how a row was first written. Read-only unless
 * `apply` is set, and safe to re-run: correct rows are left alone.
 */
export async function backfillSkillFiles(
  db: WorkerDb,
  bucket: Pick<R2Bucket, "get">,
  { apply }: { apply: boolean },
): Promise<SkillFileBackfillReport> {
  const report: SkillFileBackfillReport = {
    scanned: 0,
    correct: 0,
    repairs: [],
    missing: [],
    skipped: 0,
  };

  let lastId = "";
  while (true) {
    const rows = await db
      .select({
        id: skillFiles.id,
        versionId: skillFiles.versionId,
        path: skillFiles.path,
        sha256: skillFiles.sha256,
        size: skillFiles.size,
        r2Prefix: skillVersions.r2Prefix,
      })
      .from(skillFiles)
      .innerJoin(skillVersions, eq(skillFiles.versionId, skillVersions.id))
      .where(gt(skillFiles.id, lastId))
      .orderBy(asc(skillFiles.id))
      .limit(PAGE_SIZE);
    const last = rows.at(-1);
    if (!last) break;
    lastId = last.id;

    for (let i = 0; i < rows.length; i += CONCURRENT_READS) {
      const batch = rows.slice(i, i + CONCURRENT_READS);
      await Promise.all(
        batch.map(async (row) => {
          report.scanned += 1;
          const key = `${row.r2Prefix}/${row.path}`;
          const obj = await bucket.get(key);
          if (!obj) {
            report.missing.push({ id: row.id, versionId: row.versionId, path: row.path, key });
            return;
          }

          const after = await measure(await obj.arrayBuffer());
          if (after.sha256 === row.sha256 && after.size === row.size) {
            report.correct += 1;
            return;
          }

          if (apply) {
            // Matches on the old values too, so a row changed since the read
            // is left for the next run rather than overwritten.
            const updated = await db
              .update(skillFiles)
              .set(after)
              .where(
                and(
                  eq(skillFiles.id, row.id),
                  eq(skillFiles.sha256, row.sha256),
                  eq(skillFiles.size, row.size),
                ),
              )
              .returning({ id: skillFiles.id });
            if (updated.length === 0) {
              report.skipped += 1;
              return;
            }
          }
          report.repairs.push({
            id: row.id,
            versionId: row.versionId,
            path: row.path,
            before: { sha256: row.sha256, size: row.size },
            after,
          });
        }),
      );
    }
  }
  return report;
}
