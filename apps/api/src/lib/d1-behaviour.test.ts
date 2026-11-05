import { env } from "cloudflare:test";
import { registryQuerySchema } from "@skillist/contracts";
import {
  organizations,
  registryEntries,
  registryStars,
  skillFiles,
  skillRuns,
  skills,
  skillVersions,
  telemetryEvents,
} from "@skillist/db/schema";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { syncStarCount } from "../routes/registry";
import { seedOrg, seedUser, testDb } from "../test-support/db";
import { chunkRows, inList, isUniqueViolation, SKILL_FILE_COLUMNS } from "./db";
import { isDatabaseError } from "./error-detail";
import { listRegistry } from "./registry-service";
import { applyRetention } from "./retention";

/**
 * Pins what the data layer relies on D1 to do. Each of these failed silently, or
 * only at runtime, in the move from Postgres, and none is visible to the compiler.
 */

async function seedSkill(db: ReturnType<typeof testDb>) {
  const user = await seedUser(db);
  const org = await seedOrg(db, user.id);
  const [skill] = await db
    .insert(skills)
    .values({ orgId: org.id, repo: "repo", visibility: "public", description: "d" })
    .returning();
  if (!skill) throw new Error("no skill");
  return { user, org, skill };
}

const version = (skillId: string, semver: string) => ({
  skillId,
  status: "draft" as const,
  semver,
  r2Prefix: `p/${semver}`,
});

describe("db.batch", () => {
  it("rolls back every statement when one fails", async () => {
    const db = testDb();
    const { skill } = await seedSkill(db);
    await db.insert(skillVersions).values(version(skill.id, "1.0.0"));

    await expect(
      db.batch([
        db.update(skills).set({ description: "changed" }).where(eq(skills.id, skill.id)),
        db.insert(skillVersions).values(version(skill.id, "1.0.0")),
      ]),
    ).rejects.toThrow();

    const [row] = await db.select().from(skills).where(eq(skills.id, skill.id));
    expect(row?.description).toBe("d");
  });

  it("reports a unique violation so routes can answer 409, not 500", async () => {
    const db = testDb();
    const { skill } = await seedSkill(db);
    await db.insert(skillVersions).values(version(skill.id, "1.0.0"));

    const err = await db
      .batch([db.insert(skillVersions).values(version(skill.id, "1.0.0"))])
      .catch((e: unknown) => e);

    expect(isUniqueViolation(err)).toBe(true);
    expect(isDatabaseError(err)).toBe(true);
  });

  it("keeps a plain failure from reading as a unique violation", () => {
    expect(isUniqueViolation(new Error("something else"))).toBe(false);
    expect(isUniqueViolation("UNIQUE constraint failed")).toBe(false);
  });

  it("reports a unique violation from a single statement too", async () => {
    const db = testDb();
    const { skill } = await seedSkill(db);
    await db.insert(skillVersions).values(version(skill.id, "1.0.0"));
    const err = await db
      .insert(skillVersions)
      .values(version(skill.id, "1.0.0"))
      .catch((e: unknown) => e);
    expect(isUniqueViolation(err)).toBe(true);
  });
});

describe("bound parameter limit", () => {
  it("inserts a bundle far past 100 parameters when chunked", async () => {
    const db = testDb();
    const { skill } = await seedSkill(db);
    const [v] = await db.insert(skillVersions).values(version(skill.id, "1.0.0")).returning();
    if (!v) throw new Error("no version");
    const rows = Array.from({ length: 200 }, (_, i) => ({
      versionId: v.id,
      path: `references/${i}.md`,
      sha256: "x",
      size: 1,
    }));

    await db.batch(
      chunkRows(rows, SKILL_FILE_COLUMNS).map((chunk) =>
        db.insert(skillFiles).values(chunk),
      ) as never,
    );

    const stored = await db.select().from(skillFiles).where(eq(skillFiles.versionId, v.id));
    expect(stored).toHaveLength(200);
  });

  it("really does fail unchunked, which is why chunkRows exists", async () => {
    const db = testDb();
    const { skill } = await seedSkill(db);
    const [v] = await db.insert(skillVersions).values(version(skill.id, "1.0.0")).returning();
    if (!v) throw new Error("no version");
    const rows = Array.from({ length: 200 }, (_, i) => ({
      versionId: v.id,
      path: `references/${i}.md`,
      sha256: "x",
      size: 1,
    }));
    await expect(db.insert(skillFiles).values(rows)).rejects.toThrow();
  });

  it("matches a list of any length with inList", async () => {
    const db = testDb();
    const { skill } = await seedSkill(db);
    const list = [...Array.from({ length: 500 }, (_, i) => `absent-${i}`), skill.id];
    const rows = await db.select().from(skills).where(inList(skills.id, list));
    expect(rows.map((r) => r.id)).toEqual([skill.id]);
  });

  it("matches nothing for an empty list", async () => {
    const rows = await testDb().select().from(skills).where(inList(skills.id, []));
    expect(rows).toEqual([]);
  });
});

describe("column modes", () => {
  it("round-trips Date, boolean and JSON through their stored forms", async () => {
    const db = testDb();
    const { org, skill } = await seedSkill(db);
    const when = new Date("2026-01-02T03:04:05.678Z");
    await db.insert(registryEntries).values({
      skillId: skill.id,
      orgSlug: org.slug,
      skillRepo: "repo",
      name: "n",
      description: "d",
      latestVersion: "1.0.0",
      tags: ["a", "b"],
      lastReviewedAt: when,
    });
    const [row] = await db
      .select()
      .from(registryEntries)
      .where(eq(registryEntries.skillId, skill.id));
    expect(row?.tags).toEqual(["a", "b"]);
    expect(row?.lastReviewedAt).toEqual(when);
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it("gives default timestamps millisecond precision, stored as integers", async () => {
    const db = testDb();
    const { org } = await seedSkill(db);
    const raw = await (env as unknown as { DB: D1Database }).DB.prepare(
      "SELECT created_at, typeof(created_at) AS kind FROM organizations WHERE id = ?",
    )
      .bind(org.id)
      .first<{ created_at: number; kind: string }>();
    expect(raw?.kind).toBe("integer");
    expect(Math.abs((raw?.created_at ?? 0) - Date.now())).toBeLessThan(60_000);
  });
});

describe("syncStarCount", () => {
  async function seedEntry() {
    const db = testDb();
    const { user, org, skill } = await seedSkill(db);
    const old = new Date("2020-01-01T00:00:00.000Z");
    await db.insert(registryEntries).values({
      skillId: skill.id,
      orgSlug: org.slug,
      skillRepo: "repo",
      name: "n",
      description: "d",
      latestVersion: "1.0.0",
      updatedAt: old,
    });
    const entry = async () =>
      (await db.select().from(registryEntries).where(eq(registryEntries.skillId, skill.id)))[0];
    return { db, user, skill, old, entry };
  }

  it("counts a star, and a repeat star changes nothing", async () => {
    const { db, user, skill, old, entry } = await seedEntry();
    const star = () =>
      db.batch([
        db
          .insert(registryStars)
          .values({ userId: user.id, skillId: skill.id })
          .onConflictDoNothing(),
        syncStarCount(db, skill.id),
      ]);

    await star();
    const first = await entry();
    expect(first?.stars).toBe(1);
    expect(first?.updatedAt.getTime()).toBeGreaterThan(old.getTime());

    await db
      .update(registryEntries)
      .set({ updatedAt: old })
      .where(eq(registryEntries.skillId, skill.id));
    await star();
    const second = await entry();
    expect(second?.stars).toBe(1);
    // A no-op star must not bump the row up the "recent" sort.
    expect(second?.updatedAt).toEqual(old);
  });

  it("repairs a drifted counter", async () => {
    const { db, skill, entry } = await seedEntry();
    await db
      .update(registryEntries)
      .set({ stars: 99 })
      .where(eq(registryEntries.skillId, skill.id));
    await db.batch([syncStarCount(db, skill.id)]);
    expect((await entry())?.stars).toBe(0);
  });
});

it("enforces foreign keys, so cascades work as they did on Postgres", async () => {
  const db = testDb();
  const { org, skill } = await seedSkill(db);
  await db.delete(organizations).where(eq(organizations.id, org.id));
  expect(await db.select().from(skills).where(eq(skills.id, skill.id))).toEqual([]);
});

describe("search", () => {
  async function seedEntry(description: string) {
    const db = testDb();
    const { org, skill } = await seedSkill(db);
    const repo = `repo-${crypto.randomUUID().slice(0, 8)}`;
    await db.insert(registryEntries).values({
      skillId: skill.id,
      orgSlug: org.slug,
      skillRepo: repo,
      name: repo,
      description,
      latestVersion: "1.0.0",
    });
    return { db, repo };
  }
  // Through the schema, as the route does, so defaults match production.
  const query = (q: string) => registryQuerySchema.parse({ q, sort: "relevance" });

  it("handles a term past D1's 50-byte LIKE limit", async () => {
    const term = "a very long search phrase that is well past fifty bytes of pattern text";
    const { db, repo } = await seedEntry(`Includes ${term} somewhere`);
    const result = await listRegistry(db, query(term));
    expect(result.items.map((i) => i.skillRepo)).toContain(repo);
  });

  it("treats % and _ as literal characters", async () => {
    const { db, repo } = await seedEntry("plain description");
    const wild = await listRegistry(db, query("pl%in"));
    expect(wild.items.map((i) => i.skillRepo)).not.toContain(repo);
  });

  it("finds non-ASCII text written the same way", async () => {
    const { db, repo } = await seedEntry("Résumé parsing");
    const result = await listRegistry(db, query("Résumé"));
    expect(result.items.map((i) => i.skillRepo)).toContain(repo);
  });

  it("finds an accented capital, which lowering in JS would miss", async () => {
    const { db, repo } = await seedEntry("École records");
    const result = await listRegistry(db, query("École"));
    expect(result.items.map((i) => i.skillRepo)).toContain(repo);
  });

  it("matches regardless of case", async () => {
    const { db, repo } = await seedEntry("Handles ZEBRA Stripes");
    const result = await listRegistry(db, query("zebra"));
    expect(result.items.map((i) => i.skillRepo)).toContain(repo);
  });
});

describe("retention at volume", () => {
  it("prunes more expired rows than D1's parameter limit in one pass", async () => {
    const db = testDb();
    const old = new Date("2020-01-01T00:00:00.000Z");
    const rows = Array.from({ length: 400 }, (_, i) => ({
      orgSlug: "retention-org",
      skillRepo: `r${i}`,
      eventType: "install" as const,
      createdAt: old,
    }));
    for (const chunk of chunkRows(rows, 10)) await db.insert(telemetryEvents).values(chunk);

    const report = await applyRetention(db);

    expect(report.telemetryEvents).toBeGreaterThanOrEqual(400);
    const left = await db
      .select()
      .from(telemetryEvents)
      .where(eq(telemetryEvents.orgSlug, "retention-org"));
    expect(left).toEqual([]);
  });
});

describe("retention scrub", () => {
  it("blanks old output in bounded batches and keeps the row", async () => {
    const db = testDb();
    const { skill } = await seedSkill(db);
    const [v] = await db.insert(skillVersions).values(version(skill.id, "1.0.0")).returning();
    if (!v) throw new Error("no version");
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const [run] = await db
      .insert(skillRuns)
      .values({
        skillId: skill.id,
        versionId: v.id,
        orgSlug: "o",
        skillRepo: "r",
        scriptPath: "scripts/a.sh",
        runtime: "sandbox",
        status: "completed",
        stdout: "secret output",
        createdAt: old,
      })
      .returning();

    const report = await applyRetention(db);

    expect(report.skillRunOutputScrubbed).toBeGreaterThanOrEqual(1);
    const [row] = await db
      .select()
      .from(skillRuns)
      .where(eq(skillRuns.id, run?.id ?? ""));
    expect(row?.stdout).toBeNull();
    expect(row?.status).toBe("completed");
  });
});

describe("query plans", () => {
  const plan = async (sql: string) => {
    const { results } = await (env as unknown as { DB: D1Database }).DB.prepare(
      `EXPLAIN QUERY PLAN ${sql}`,
    ).all<{ detail: string }>();
    return results.map((r) => r.detail).join(" | ");
  };

  // Full scans here are what cost the most on a single-threaded database, and
  // nothing else notices one until the table is large.
  it.each([
    ["retention by age", "SELECT id FROM telemetry_events WHERE created_at < 1 LIMIT 10"],
    ["audit retention", "SELECT id FROM audit_events WHERE created_at < 1 LIMIT 10"],
    [
      "the telemetry dedupe on every event",
      "SELECT id FROM telemetry_events WHERE org_slug = 'a' AND skill_repo = 'b' AND created_at >= 1 LIMIT 1",
    ],
    [
      "org audit log",
      "SELECT id FROM audit_events WHERE org_id = 'a' ORDER BY created_at DESC LIMIT 10",
    ],
    ["run history", "SELECT id FROM skill_runs WHERE skill_id = 'a' ORDER BY created_at DESC"],
    ["registry name sort", "SELECT id FROM registry_entries ORDER BY name LIMIT 10"],
  ])("%s uses an index", async (_name, sql) => {
    const detail = await plan(sql);
    expect(detail).toContain("USING");
    expect(detail).not.toMatch(/SCAN \w+$/);
    expect(detail).not.toContain("TEMP B-TREE");
  });
});
