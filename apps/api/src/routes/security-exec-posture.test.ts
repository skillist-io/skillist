import { env, SELF } from "cloudflare:test";
import {
  apiKeys,
  organizations,
  orgMembers,
  skills,
  skillVersions,
  users,
} from "@skillist/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeWorkerDb, createWorkerDb } from "../lib/db";
import { sha256 } from "../lib/r2";

// Regression for H4: the run path must re-check the stored security posture, not
// trust that publishing gated on it. A version whose scan hard-failed is refused
// execution (403); an advisory version is NOT blocked by the posture gate.
//
// The gate throws right after the bundle loads and before the sandbox runs, so
// these cases exercise it without a container — an unblocked run just proceeds
// to the "script not found in bundle" 400 (the test seeds no R2 objects).

const REAL_DB = Boolean((env as Record<string, unknown>).INTEGRATION_DB);

const authHeader = (rawKey: string) => ({
  Authorization: `Bearer ${rawKey}`,
  "Content-Type": "application/json",
});

describe.skipIf(!REAL_DB)("execution security-posture gate — integration (requires DB)", () => {
  let db: ReturnType<typeof createWorkerDb>;
  const suffix = crypto.randomUUID().slice(0, 8);
  const orgId = crypto.randomUUID();
  const orgSlug = `posture-${suffix}`;
  const userId = `posture-user-${suffix}`;
  const keyRaw = `sk_test_posture_${suffix}`;

  async function seedSkill(repo: string, securityStatus: "fail" | "advisory") {
    const [skill] = await db
      .insert(skills)
      .values({ orgId, repo, visibility: "public", runtime: "sandbox", description: repo })
      .returning({ id: skills.id });
    const skillId = skill?.id ?? "";
    const [version] = await db
      .insert(skillVersions)
      .values({
        skillId,
        semver: "1.0.0",
        r2Prefix: `orgs/${orgId}/skills/${skillId}/1.0.0`,
        securityStatus,
      })
      .returning({ id: skillVersions.id });
    await db
      .update(skills)
      .set({ latestPublishedVersionId: version?.id ?? "" })
      .where(eq(skills.id, skillId));
  }

  beforeAll(async () => {
    if (!REAL_DB) return;
    db = createWorkerDb(env);
    await db.insert(users).values({ id: userId, name: "P", email: `p_${suffix}@ex.test` });
    await db.insert(organizations).values({ id: orgId, name: `P ${suffix}`, slug: orgSlug });
    await db.insert(orgMembers).values({ orgId, userId, role: "owner" });
    await seedSkill("failed", "fail");
    await seedSkill("advisory", "advisory");
    await db.insert(apiKeys).values({
      orgId,
      name: "p",
      keyHash: await sha256(keyRaw),
      keyPrefix: "sk_test",
      scopes: ["skills:read", "skills:run"],
      createdBy: userId,
    });
  });

  afterAll(async () => {
    if (!REAL_DB || !db) return;
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await db.delete(users).where(eq(users.id, userId));
    await closeWorkerDb(db);
  });

  const run = (repo: string) =>
    SELF.fetch(`http://localhost/${orgSlug}/${repo}/run`, {
      method: "POST",
      headers: authHeader(keyRaw),
      body: JSON.stringify({ scriptPath: "scripts/run.sh" }),
    });

  it("refuses to execute a version that failed its security scan (403)", async () => {
    const res = await run("failed");
    expect(res.status).toBe(403);
  });

  it("does not block an advisory version at the posture gate", async () => {
    // Not blocked by posture, so it proceeds past the gate and fails later on
    // the missing bundle script (400) — proving advisory stays runnable.
    const res = await run("advisory");
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(400);
  });
});
