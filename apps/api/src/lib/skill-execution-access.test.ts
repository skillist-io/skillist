import type { organizations, skills } from "@skillist/db/schema";
import { describe, expect, it } from "vitest";
import { cleanup, hasTestDb, seedOrg, seedUser, withDb } from "../test-support/db";
import type { AuthContext } from "./auth-middleware";
import type { WorkerDb } from "./db";
import { assertSkillRunAccess } from "./skill-execution-access";

const OWNER_ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: null,
    apiKeyId: null,
    apiKeyOrgId: null,
    apiKeyCreatedBy: null,
    apiKeyScopes: [],
    ...overrides,
  };
}

function org(
  executionPolicy: Record<string, unknown> | null = null,
  id = OWNER_ORG,
): typeof organizations.$inferSelect {
  return { id, executionPolicy } as unknown as typeof organizations.$inferSelect;
}

function skill(
  visibility: "public" | "private" | "org" = "public",
  orgId = OWNER_ORG,
): typeof skills.$inferSelect {
  return {
    orgId,
    visibility,
    latestPublishedVersionId: "33333333-3333-4333-8333-333333333333",
  } as unknown as typeof skills.$inferSelect;
}

/**
 * A database that fails loudly if touched.
 *
 * Several of these paths are supposed to resolve without a query — an API key
 * carries its org, and an owner who has opened runs to everyone needs no
 * membership lookup. Passing this proves that rather than assuming it, and
 * turns a stray query on the hot execution path into a failing test.
 */
const noDb = new Proxy(
  {},
  {
    get() {
      throw new Error("database was queried on a path that should not need one");
    },
  },
) as WorkerDb;

describe("assertSkillRunAccess — public skills", () => {
  it("404s a skill with no published version", async () => {
    const unpublished = { ...skill(), latestPublishedVersionId: null };
    const result = await assertSkillRunAccess(
      noDb,
      auth({ userId: "u1" }),
      org(),
      unpublished as typeof skills.$inferSelect,
    );
    expect(result).toEqual({ ok: false, status: 404 });
  });

  it("blocks anonymous runs but allows anonymous viewing", async () => {
    const run = await assertSkillRunAccess(noDb, auth(), org(), skill(), "run");
    expect(run).toEqual({ ok: false, status: 401 });

    const view = await assertSkillRunAccess(noDb, auth(), org(), skill(), "view");
    expect(view).toMatchObject({ ok: true, isAnonymous: true });
  });

  it("lets an API key from the owning org run without a query", async () => {
    const result = await assertSkillRunAccess(
      noDb,
      auth({ apiKeyId: "k1", apiKeyOrgId: OWNER_ORG, apiKeyScopes: ["skills:run"] }),
      org(),
      skill(),
    );
    expect(result).toMatchObject({ ok: true, actorType: "api_key" });
  });

  it("refuses a run from an API key without skills:run", async () => {
    const result = await assertSkillRunAccess(
      noDb,
      auth({ apiKeyId: "k1", apiKeyOrgId: OWNER_ORG, apiKeyScopes: ["skills:read"] }),
      org(),
      skill(),
    );
    expect(result).toEqual({ ok: false, status: 403 });
  });

  // The denial-of-wallet case: a run spends the OWNER's quota and sandbox
  // compute, so a scoped key belonging to someone else must not trigger one.
  it("refuses a cross-org API key run by default", async () => {
    const result = await assertSkillRunAccess(
      noDb,
      auth({ apiKeyId: "k1", apiKeyOrgId: OTHER_ORG, apiKeyScopes: ["skills:run"] }),
      org(),
      skill(),
    );
    expect(result).toEqual({ ok: false, status: 403 });
  });

  it("allows a cross-org API key run once the owner opts in", async () => {
    const result = await assertSkillRunAccess(
      noDb,
      auth({ apiKeyId: "k1", apiKeyOrgId: OTHER_ORG, apiKeyScopes: ["skills:run"] }),
      org({ allowPublicRuns: true }),
      skill(),
    );
    expect(result).toMatchObject({ ok: true, actorType: "api_key" });
  });

  it("still allows cross-org VIEWING — public means readable", async () => {
    const result = await assertSkillRunAccess(
      noDb,
      auth({ apiKeyId: "k1", apiKeyOrgId: OTHER_ORG, apiKeyScopes: ["skills:read"] }),
      org(),
      skill(),
      "view",
    );
    expect(result).toMatchObject({ ok: true });
  });

  it("skips the membership lookup entirely when the owner has opted in", async () => {
    const result = await assertSkillRunAccess(
      noDb,
      auth({ userId: "anyone" }),
      org({ allowPublicRuns: true }),
      skill(),
    );
    expect(result).toMatchObject({ ok: true, actorType: "user" });
  });

  it("treats a missing policy and an explicit false the same way", async () => {
    const withNullPolicy = await assertSkillRunAccess(
      noDb,
      auth({ apiKeyId: "k1", apiKeyOrgId: OTHER_ORG, apiKeyScopes: ["skills:run"] }),
      org(null),
      skill(),
    );
    const withExplicitFalse = await assertSkillRunAccess(
      noDb,
      auth({ apiKeyId: "k1", apiKeyOrgId: OTHER_ORG, apiKeyScopes: ["skills:run"] }),
      org({ allowPublicRuns: false }),
      skill(),
    );
    expect(withNullPolicy).toEqual({ ok: false, status: 403 });
    expect(withExplicitFalse).toEqual({ ok: false, status: 403 });
  });
});

describe.skipIf(!hasTestDb)("assertSkillRunAccess — session membership (requires DB)", () => {
  it("lets a member of the owning org run, and refuses an outsider", async () => {
    await withDb(async (db) => {
      const owner = await seedUser(db);
      const outsider = await seedUser(db);
      const ownerOrg = await seedOrg(db, owner.id);

      const insider = await assertSkillRunAccess(
        db,
        auth({ userId: owner.id }),
        org(null, ownerOrg.id),
        skill("public", ownerOrg.id),
      );
      expect(insider).toMatchObject({ ok: true, actorType: "user" });

      // Signed in, but with no membership in the org that pays for the run.
      const stranger = await assertSkillRunAccess(
        db,
        auth({ userId: outsider.id }),
        org(null, ownerOrg.id),
        skill("public", ownerOrg.id),
      );
      expect(stranger).toEqual({ ok: false, status: 403 });

      // The same stranger may still read it.
      const reading = await assertSkillRunAccess(
        db,
        auth({ userId: outsider.id }),
        org(null, ownerOrg.id),
        skill("public", ownerOrg.id),
        "view",
      );
      expect(reading).toMatchObject({ ok: true });

      await cleanup(db, { users: [owner.id, outsider.id], orgs: [ownerOrg.id] });
    });
  });

  it("admits the outsider once the owner opts in", async () => {
    await withDb(async (db) => {
      const owner = await seedUser(db);
      const outsider = await seedUser(db);
      const ownerOrg = await seedOrg(db, owner.id);

      const result = await assertSkillRunAccess(
        db,
        auth({ userId: outsider.id }),
        org({ allowPublicRuns: true }, ownerOrg.id),
        skill("public", ownerOrg.id),
      );
      expect(result).toMatchObject({ ok: true, actorType: "user" });

      await cleanup(db, { users: [owner.id, outsider.id], orgs: [ownerOrg.id] });
    });
  });
});

describe.skipIf(!hasTestDb)("assertSkillRunAccess — private skills (requires DB)", () => {
  it("is unchanged: org members run, outsiders are refused", async () => {
    await withDb(async (db) => {
      const owner = await seedUser(db);
      const outsider = await seedUser(db);
      const ownerOrg = await seedOrg(db, owner.id);

      const member = await assertSkillRunAccess(
        db,
        auth({ userId: owner.id }),
        org(null, ownerOrg.id),
        skill("private", ownerOrg.id),
      );
      expect(member).toMatchObject({ ok: true });

      const stranger = await assertSkillRunAccess(
        db,
        auth({ userId: outsider.id }),
        org(null, ownerOrg.id),
        skill("private", ownerOrg.id),
      );
      expect(stranger.ok).toBe(false);

      // allowPublicRuns must not leak into private skills.
      const withOptIn = await assertSkillRunAccess(
        db,
        auth({ userId: outsider.id }),
        org({ allowPublicRuns: true }, ownerOrg.id),
        skill("private", ownerOrg.id),
      );
      expect(withOptIn.ok).toBe(false);

      await cleanup(db, { users: [owner.id, outsider.id], orgs: [ownerOrg.id] });
    });
  });
});
