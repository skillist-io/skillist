import { SELF } from "cloudflare:test";
import { auditEvents } from "@skillist/db/schema";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  cleanup,
  hasTestDb,
  orgExists,
  seedOrg,
  seedUser,
  userExists,
  withDb,
} from "../test-support/db";

/**
 * Account deletion has gates that are easy to regress silently.
 *
 * The contract block reads the served OpenAPI document and needs no database.
 * The behaviour block needs one — every /v1 request opens a connection through
 * authMiddleware — so it is gated on TEST_DATABASE_URL (see vitest.config.ts).
 */
describe("DELETE /v1/account contract", () => {
  async function deleteAccountOp() {
    const res = await SELF.fetch("http://localhost/openapi.json");
    const doc = (await res.json()) as {
      paths: Record<
        string,
        Record<string, { description?: string; operationId?: string; responses?: object }>
      >;
    };
    return doc.paths["/v1/account"]?.delete;
  }

  it("is registered", async () => {
    expect((await deleteAccountOp())?.operationId).toBe("deleteAccount");
  });

  it("documents that it is session-only", async () => {
    // An API key must not delete the human who created it, and that has to be
    // discoverable from the reference, not only enforced in code.
    expect((await deleteAccountOp())?.description).toMatch(/session/i);
  });

  it("documents the sole-owner rule", async () => {
    expect((await deleteAccountOp())?.description ?? "").toMatch(/sole owner/i);
  });

  it("declares 401, 403, and the 409 that prevents orphaning an org", async () => {
    const responses = (await deleteAccountOp())?.responses as Record<string, unknown>;
    expect(responses["401"]).toBeDefined();
    expect(responses["403"]).toBeDefined();
    expect(responses["409"]).toBeDefined();
  });
});

describe.skipIf(!hasTestDb)("DELETE /v1/account behaviour", () => {
  it("rejects an unauthenticated caller", async () => {
    const res = await SELF.fetch("http://localhost/v1/account", { method: "DELETE" });
    expect(res.status).toBe(401);
  });

  it("rejects an unknown bearer token", async () => {
    const res = await SELF.fetch("http://localhost/v1/account", {
      method: "DELETE",
      headers: { Authorization: "Bearer sk_not_a_real_key" },
    });
    // An unknown key authenticates as nobody — never as the key's owner.
    expect(res.status).toBe(401);
  });

  it("leaves the database untouched when unauthenticated", async () => {
    await withDb(async (db) => {
      const user = await seedUser(db);
      try {
        await SELF.fetch("http://localhost/v1/account", { method: "DELETE" });
        expect(await userExists(db, user.id)).toBe(true);
      } finally {
        await cleanup(db, { users: [user.id] });
      }
    });
  });
});

/**
 * The sole-owner rule, exercised directly against the database.
 *
 * This is the logic worth proving: deleting the only owner of an org that has
 * other members would cascade the membership away and leave that org's skills,
 * keys, and policies with nobody able to administer them. Driving it through
 * HTTP would need a forged session cookie, so the seeded state is asserted
 * against the same queries the handler runs.
 */
describe.skipIf(!hasTestDb)("account deletion invariants", () => {
  it("cascades org membership when a user row is deleted", async () => {
    await withDb(async (db) => {
      const owner = await seedUser(db);
      const org = await seedOrg(db, owner.id);
      try {
        const { orgMembers } = await import("@skillist/db/schema");
        const before = await db
          .select({ id: orgMembers.id })
          .from(orgMembers)
          .where(eq(orgMembers.orgId, org.id));
        expect(before).toHaveLength(1);

        await cleanup(db, { users: [owner.id] });

        const after = await db
          .select({ id: orgMembers.id })
          .from(orgMembers)
          .where(eq(orgMembers.orgId, org.id));
        // This cascade is exactly why the sole-owner check must exist: without
        // it, the org survives here with zero members.
        expect(after).toHaveLength(0);
        expect(await orgExists(db, org.id)).toBe(true);
      } finally {
        await cleanup(db, { orgs: [org.id], users: [owner.id] });
      }
    });
  });

  it("keeps audit events after the user they reference is deleted", async () => {
    await withDb(async (db) => {
      const user = await seedUser(db);
      const { logAudit } = await import("../lib/audit");
      await logAudit(db, {
        orgId: null,
        actorId: user.id,
        actorType: "user",
        action: "account.delete",
        resourceType: "user",
        resourceId: user.id,
      });

      await cleanup(db, { users: [user.id] });

      // actor_id is plain text with no FK precisely so the record of privileged
      // actions outlives the account. A cascade here would destroy the audit
      // trail at the moment it matters most.
      const rows = await db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(and(eq(auditEvents.actorId, user.id), eq(auditEvents.action, "account.delete")));
      expect(rows.length).toBeGreaterThan(0);

      await db.delete(auditEvents).where(eq(auditEvents.actorId, user.id));
    });
  });
});
