import { env } from "cloudflare:test";
import { skillFiles, skills, skillVersions } from "@skillist/db/schema";
import { encodeBase64, objectToBundle, type SkillBundle } from "@skillist/skill-format";
import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { seedOrg, seedUser, testDb } from "../test-support/db";
import { bundleFileManifest, r2Prefix, sha256, uploadBundleToR2 } from "./r2";
import { backfillSkillFiles } from "./skill-file-backfill";

type Db = ReturnType<typeof testDb>;

const SKILL_MD = "---\nname: backfill\ndescription: Café 🚀\n---\n日本語\n";
const LOGO = encodeBase64(new Uint8Array([137, 80, 78, 71, 1, 2, 3, 255]));

/** Seeds a version whose rows use the pre-fix formula: text length and a hash of the string. */
async function seedLegacyVersion(db: Db, bundle: SkillBundle) {
  const user = await seedUser(db);
  const org = await seedOrg(db, user.id);
  const [skill] = await db
    .insert(skills)
    .values({ orgId: org.id, repo: "backfill", visibility: "public" })
    .returning();
  if (!skill) throw new Error("no skill");
  const prefix = r2Prefix(org.id, "backfill", crypto.randomUUID());
  await uploadBundleToR2(env.SKILLS_R2, prefix, bundle);
  const [version] = await db
    .insert(skillVersions)
    .values({ skillId: skill.id, status: "published", semver: "1.0.0", r2Prefix: prefix })
    .returning();
  if (!version) throw new Error("no version");
  await db.insert(skillFiles).values(
    await Promise.all(
      [...bundle].map(async ([path, content]) => ({
        versionId: version.id,
        path,
        sha256: await sha256(content),
        size: content.length,
      })),
    ),
  );
  return { versionId: version.id, prefix };
}

const rowsFor = (db: Db, versionId: string) =>
  db.select().from(skillFiles).where(eq(skillFiles.versionId, versionId));

describe("backfillSkillFiles", () => {
  // The scan covers the whole table, so each test starts without other tests' rows.
  beforeEach(async () => {
    const db = testDb();
    const ids = (await db.select({ id: skillFiles.id }).from(skillFiles)).map((r) => r.id);
    for (let i = 0; i < ids.length; i += 50) {
      await db.delete(skillFiles).where(inArray(skillFiles.id, ids.slice(i, i + 50)));
    }
  });

  it("reports repairs in a dry run without writing", async () => {
    const db = testDb();
    const bundle = objectToBundle({ "SKILL.md": SKILL_MD, "assets/logo.png": LOGO });
    const { versionId } = await seedLegacyVersion(db, bundle);
    const before = await rowsFor(db, versionId);

    const report = await backfillSkillFiles(db, env.SKILLS_R2, { apply: false });

    expect(report.scanned).toBe(2);
    expect(report.repairs.map((r) => r.path).sort()).toEqual(["SKILL.md", "assets/logo.png"]);
    expect(await rowsFor(db, versionId)).toEqual(before);
  });

  it("makes rows match the stored bytes, and a second run finds nothing", async () => {
    const db = testDb();
    const bundle = objectToBundle({
      "SKILL.md": SKILL_MD,
      "references/ascii.md": "plain\n",
      "assets/logo.png": LOGO,
    });
    const { versionId } = await seedLegacyVersion(db, bundle);

    const first = await backfillSkillFiles(db, env.SKILLS_R2, { apply: true });
    expect(first.repairs).toHaveLength(2);
    expect(first.correct).toBe(1);

    for (const row of await rowsFor(db, versionId)) {
      const expected = await bundleFileManifest(row.path, bundle.get(row.path) ?? "");
      expect({ path: row.path, sha256: row.sha256, size: row.size }).toEqual(expected);
    }

    const second = await backfillSkillFiles(db, env.SKILLS_R2, { apply: true });
    expect(second.repairs).toEqual([]);
    expect(second.correct).toBe(3);
  });

  it("reports a row with no R2 object and leaves it unchanged", async () => {
    const db = testDb();
    const { versionId, prefix } = await seedLegacyVersion(
      db,
      objectToBundle({ "SKILL.md": SKILL_MD }),
    );
    await env.SKILLS_R2.delete(`${prefix}/SKILL.md`);
    const before = await rowsFor(db, versionId);

    const report = await backfillSkillFiles(db, env.SKILLS_R2, { apply: true });

    expect(report.missing).toHaveLength(1);
    expect(report.missing[0]?.key).toBe(`${prefix}/SKILL.md`);
    expect(await rowsFor(db, versionId)).toEqual(before);
  });

  it("does not overwrite a row changed during the run", async () => {
    const db = testDb();
    const { versionId } = await seedLegacyVersion(db, objectToBundle({ "SKILL.md": SKILL_MD }));

    // Stands in for a concurrent writer, landing between the read and the update.
    const racingBucket = {
      get: async (key: string) => {
        const obj = await env.SKILLS_R2.get(key);
        await db.update(skillFiles).set({ size: 1 }).where(eq(skillFiles.versionId, versionId));
        return obj;
      },
    } as unknown as R2Bucket;

    const report = await backfillSkillFiles(db, racingBucket, { apply: true });

    expect(report.skipped).toBe(1);
    expect(report.repairs).toEqual([]);
    expect((await rowsFor(db, versionId))[0]?.size).toBe(1);
  });
});
