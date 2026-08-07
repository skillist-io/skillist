import { env, SELF } from "cloudflare:test";
import {
  apiKeys,
  organizations,
  orgMembers,
  registryEntries,
  skills,
  skillVersions,
  telemetryEvents,
  users,
} from "@skillist/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Env } from "../env";
import { closeWorkerDb, createWorkerDb } from "../lib/db";
import { sha256 } from "../lib/r2";

// `skillist sync` materializes one skill into every agent harness in a project
// and reports an activation per (skill, harness). These tests pin the two
// properties that makes that dataset worth having:
//   1. `harness`/`scope` survive ingestion, so "which harnesses is this skill
//      actually live in" is answerable.
//   2. The per-harness rows do NOT multiply the public ranking counter — that
//      stays deduped per actor/day (see security-p0.test.ts H2).
//
// Requires a real Postgres (INTEGRATION_DB from TEST_DATABASE_URL); see
// apps/api/CLAUDE.md.
const REAL_DB = Boolean((env as Record<string, unknown>).INTEGRATION_DB);

describe.skipIf(!REAL_DB)("telemetry harness attribution (requires DB)", () => {
  let db: ReturnType<typeof createWorkerDb>;
  const suffix = crypto.randomUUID().slice(0, 8);
  const orgId = crypto.randomUUID();
  const orgSlug = `tel-${suffix}`;
  const userId = `tel-user-${suffix}`;
  const rawKey = `sk_test_tel_${suffix}`;
  const repo = "widget";

  const post = (body: Record<string, unknown>) =>
    SELF.fetch("http://localhost/v1/telemetry", {
      method: "POST",
      headers: { Authorization: `Bearer ${rawKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ orgSlug, skillRepo: repo, ...body }),
    });

  beforeAll(async () => {
    if (!REAL_DB) return;
    db = createWorkerDb(env as unknown as Env);

    await db.insert(users).values({ id: userId, name: "T", email: `t_${suffix}@ex.test` });
    await db.insert(organizations).values({ id: orgId, name: `T ${suffix}`, slug: orgSlug });
    await db.insert(orgMembers).values({ orgId, userId, role: "owner" });

    const [skill] = await db
      .insert(skills)
      .values({ orgId, repo, visibility: "public", description: "widget" })
      .returning({ id: skills.id });
    const skillId = skill?.id ?? "";
    await db
      .insert(skillVersions)
      .values({ skillId, semver: "1.0.0", r2Prefix: `orgs/${orgId}/skills/${skillId}/1.0.0` });
    await db
      .insert(registryEntries)
      .values({ skillId, orgSlug, skillRepo: repo, name: "Widget", description: "widget" });

    await db.insert(apiKeys).values({
      orgId,
      name: "t",
      keyHash: await sha256(rawKey),
      keyPrefix: "sk_test",
      scopes: ["skills:read", "skills:run"],
      createdBy: userId,
    });
  });

  afterAll(async () => {
    if (!REAL_DB) return;
    await db.delete(telemetryEvents).where(eq(telemetryEvents.orgSlug, orgSlug));
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await db.delete(users).where(eq(users.id, userId));
    await closeWorkerDb(db);
  });

  it("persists harness and scope on the event row", async () => {
    expect(
      (await post({ eventType: "activation", harness: "claude", scope: "project" })).status,
    ).toBe(201);

    const rows = await db
      .select({ harness: telemetryEvents.harness, scope: telemetryEvents.scope })
      .from(telemetryEvents)
      .where(
        and(
          eq(telemetryEvents.orgSlug, orgSlug),
          eq(telemetryEvents.skillRepo, repo),
          eq(telemetryEvents.harness, "claude"),
        ),
      );
    expect(rows).toEqual([{ harness: "claude", scope: "project" }]);
  });

  it("records one row per harness so the delivery breakdown is complete", async () => {
    const readCount = async () => {
      const [row] = await db
        .select({ activationCount: registryEntries.activationCount })
        .from(registryEntries)
        .where(and(eq(registryEntries.orgSlug, orgSlug), eq(registryEntries.skillRepo, repo)))
        .limit(1);
      return row?.activationCount ?? 0;
    };
    const before = await readCount();

    // One `skillist sync` fanning a skill out to two more harnesses.
    expect(
      (await post({ eventType: "activation", harness: "cursor", scope: "project" })).status,
    ).toBe(201);
    expect((await post({ eventType: "activation", harness: "codex", scope: "user" })).status).toBe(
      201,
    );

    const harnesses = await db
      .select({ harness: telemetryEvents.harness })
      .from(telemetryEvents)
      .where(and(eq(telemetryEvents.orgSlug, orgSlug), eq(telemetryEvents.skillRepo, repo)));
    expect(new Set(harnesses.map((h) => h.harness))).toEqual(
      new Set(["claude", "cursor", "codex"]),
    );

    // Ranking integrity: three harnesses is still one actor, so the public
    // counter must not move again today.
    expect(await readCount()).toBe(before);
  });

  it("accepts events with no harness, keeping older CLIs working", async () => {
    expect((await post({ eventType: "install" })).status).toBe(201);

    const rows = await db
      .select({ harness: telemetryEvents.harness, scope: telemetryEvents.scope })
      .from(telemetryEvents)
      .where(and(eq(telemetryEvents.orgSlug, orgSlug), eq(telemetryEvents.eventType, "install")));
    expect(rows).toEqual([{ harness: null, scope: null }]);
  });

  it("rejects an unknown harness rather than storing free text", async () => {
    const res = await post({ eventType: "activation", harness: "not-a-harness" });
    expect(res.status).toBe(400);
  });

  it("aggregates the delivery breakdown for the observability dashboard", async () => {
    const res = await SELF.fetch(`http://localhost/v1/orgs/${orgId}/observability?days=30`, {
      headers: { Authorization: `Bearer ${rawKey}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      telemetry: {
        byHarness: {
          harness: string;
          activations: number;
          skills: number;
          projectScoped: number;
          userScoped: number;
        }[];
      };
    };

    // Ordered by activations desc; each harness saw one activation of one skill
    // from the tests above, and the install event (no harness) is excluded.
    const byHarness = Object.fromEntries(body.telemetry.byHarness.map((r) => [r.harness, r]));
    expect(Object.keys(byHarness).sort()).toEqual(["claude", "codex", "cursor"]);
    expect(byHarness.claude).toEqual({
      harness: "claude",
      activations: 1,
      skills: 1,
      projectScoped: 1,
      userScoped: 0,
    });
    expect(byHarness.codex).toMatchObject({ projectScoped: 0, userScoped: 1 });
  });
});
