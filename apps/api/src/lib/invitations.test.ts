import { SELF } from "cloudflare:test";
import { orgInvitations } from "@skillist/db/schema";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { cleanup, hasTestDb, seedOrg, seedUser, testDb, withDb } from "../test-support/db";
import {
  acceptOrgInvitation,
  buildInvitationEmail,
  createInvitationToken,
  createOrgInvitation,
  findPendingInvitation,
  hashInvitationToken,
  INVITATION_TTL_MS,
  listPendingInvitations,
  normalizeEmail,
  revokeOrgInvitation,
} from "./invitations";

// A valid v4 UUID, for shape checks that must clear Zod before a handler runs.
const SAMPLE_ORG = "11111111-1111-4111-8111-111111111111";

// ---------------------------------------------------------------------------
// No-DB tests: token construction, email rendering, and route wiring.
// ---------------------------------------------------------------------------
describe("invitation tokens and email (no DB)", () => {
  it("mints a prefixed token and stores only its hash", async () => {
    const { token, tokenHash } = await createInvitationToken();
    expect(token.startsWith("inv_")).toBe(true);
    // 64 hex chars of sha256, and the raw token must not be recoverable from it.
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).not.toContain(token);
    expect(await hashInvitationToken(token)).toBe(tokenHash);
  });

  it("never mints the same token twice", async () => {
    const tokens = await Promise.all(
      Array.from({ length: 25 }, () => createInvitationToken().then((t) => t.token)),
    );
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("normalizes email case and surrounding whitespace", () => {
    expect(normalizeEmail("  Teammate@Example.COM ")).toBe("teammate@example.com");
  });

  it("escapes the org name so it cannot inject markup into the email body", () => {
    const message = buildInvitationEmail({
      orgName: '<img src=x onerror="alert(1)">Acme',
      role: "viewer",
      url: "https://console.skillist.io/invite?token=inv_abc",
    });
    expect(message.html).not.toContain("<img");
    expect(message.html).toContain("&lt;img");
    // The plain-text part carries no markup, so it is left unescaped.
    expect(message.text).toContain("<img");
  });

  it("puts the accept URL in both the HTML and text parts", () => {
    const url = "https://console.skillist.io/invite?token=inv_abc";
    const message = buildInvitationEmail({ orgName: "Acme", role: "editor", url });
    expect(message.html).toContain(url);
    expect(message.text).toContain(url);
    expect(message.subject).toContain("Acme");
  });

  it("expires invitations in 7 days", () => {
    expect(INVITATION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("invitation routes — wiring & validation (no DB)", () => {
  it("registers every invitation endpoint in the OpenAPI document", async () => {
    const res = await SELF.fetch("http://localhost/openapi.json");
    const doc = (await res.json()) as { paths: Record<string, Record<string, unknown>> };
    expect(doc.paths["/v1/orgs/{orgId}/invitations"]?.get).toBeDefined();
    expect(doc.paths["/v1/orgs/{orgId}/invitations/{invitationId}"]?.delete).toBeDefined();
    expect(doc.paths["/v1/invitations/{token}"]?.get).toBeDefined();
    expect(doc.paths["/v1/invitations/{token}/accept"]?.post).toBeDefined();
  });

  it("gates the unauthenticated owner-only routes with 401", async () => {
    const list = await SELF.fetch(`http://localhost/v1/orgs/${SAMPLE_ORG}/invitations`);
    const revoke = await SELF.fetch(
      `http://localhost/v1/orgs/${SAMPLE_ORG}/invitations/${SAMPLE_ORG}`,
      { method: "DELETE" },
    );
    expect(list.status).toBe(401);
    expect(revoke.status).toBe(401);
  });

  it("requires a session to accept, even with a token", async () => {
    const res = await SELF.fetch("http://localhost/v1/invitations/inv_whatever/accept", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Integration: the lifecycle rules. Called directly against a seeded database
// because user sessions cannot be forged over HTTP in this harness.
// ---------------------------------------------------------------------------
describe.skipIf(!hasTestDb)("invitation lifecycle (requires DB)", () => {
  let db: ReturnType<typeof testDb>;
  let ownerId: string;
  let orgId: string;
  const seededUsers: string[] = [];
  const seededOrgs: string[] = [];

  beforeAll(async () => {
    // `describe.skipIf` still runs suite hooks, so bail out without a database.
    if (!hasTestDb) return;
    db = testDb();
    const owner = await seedUser(db);
    ownerId = owner.id;
    seededUsers.push(owner.id);
    const org = await seedOrg(db, owner.id);
    orgId = org.id;
    seededOrgs.push(org.id);

    return async () => {
      await cleanup(db, { users: seededUsers, orgs: seededOrgs });
    };
  });

  it("creates a pending invitation resolvable by its raw token", async () => {
    const { token } = await createOrgInvitation(db, {
      orgId,
      email: "Newcomer@Example.test",
      role: "editor",
      invitedBy: ownerId,
    });

    const preview = await findPendingInvitation(db, token);
    expect(preview).not.toBeNull();
    expect(preview?.email).toBe("newcomer@example.test");
    expect(preview?.role).toBe("editor");
  });

  it("does not resolve an unknown token", async () => {
    expect(await findPendingInvitation(db, "inv_nonexistent")).toBeNull();
  });

  it("supersedes an earlier pending invite for the same address", async () => {
    const email = "resent@example.test";
    const first = await createOrgInvitation(db, {
      orgId,
      email,
      role: "viewer",
      invitedBy: ownerId,
    });
    const second = await createOrgInvitation(db, {
      orgId,
      email,
      role: "owner",
      invitedBy: ownerId,
    });

    // The old link is dead; only the new one resolves.
    expect(await findPendingInvitation(db, first.token)).toBeNull();
    expect((await findPendingInvitation(db, second.token))?.role).toBe("owner");

    const pending = (await listPendingInvitations(db, orgId)).filter((i) => i.email === email);
    expect(pending).toHaveLength(1);
  });

  it("does not resolve an expired invitation", async () => {
    const { token, id } = await createOrgInvitation(db, {
      orgId,
      email: "expired@example.test",
      role: "viewer",
      invitedBy: ownerId,
    });
    await db
      .update(orgInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(orgInvitations.id, id));

    expect(await findPendingInvitation(db, token)).toBeNull();
    const pending = await listPendingInvitations(db, orgId);
    expect(pending.some((i) => i.email === "expired@example.test")).toBe(false);
  });

  it("revokes a pending invitation and kills its link", async () => {
    const { token, id } = await createOrgInvitation(db, {
      orgId,
      email: "revoked@example.test",
      role: "viewer",
      invitedBy: ownerId,
    });

    expect(await revokeOrgInvitation(db, { orgId, invitationId: id })).not.toBeNull();
    expect(await findPendingInvitation(db, token)).toBeNull();
    // Revoking twice is a miss, not a second success.
    expect(await revokeOrgInvitation(db, { orgId, invitationId: id })).toBeNull();
  });

  it("will not revoke another org's invitation", async () => {
    const otherOwner = await seedUser(db);
    seededUsers.push(otherOwner.id);
    const otherOrg = await seedOrg(db, otherOwner.id);
    seededOrgs.push(otherOrg.id);

    const { id, token } = await createOrgInvitation(db, {
      orgId,
      email: "cross-org@example.test",
      role: "viewer",
      invitedBy: ownerId,
    });

    // Correct invitation id, wrong org: must not match.
    expect(await revokeOrgInvitation(db, { orgId: otherOrg.id, invitationId: id })).toBeNull();
    expect(await findPendingInvitation(db, token)).not.toBeNull();
  });

  it("accepts an invitation and grants the invited role", async () => {
    const invitee = await seedUser(db);
    seededUsers.push(invitee.id);
    const { token } = await createOrgInvitation(db, {
      orgId,
      // Deliberately different case from the stored user email, to prove the
      // comparison is case-insensitive on both sides.
      email: invitee.email.toUpperCase(),
      role: "publisher",
      invitedBy: ownerId,
    });

    const result = await acceptOrgInvitation(db, { token, userId: invitee.id });
    expect(result).toMatchObject({ ok: true, orgId, role: "publisher" });
  });

  it("refuses an invitation redeemed by a different account", async () => {
    const invitee = await seedUser(db);
    const bystander = await seedUser(db);
    seededUsers.push(invitee.id, bystander.id);
    const { token } = await createOrgInvitation(db, {
      orgId,
      email: invitee.email,
      role: "owner",
      invitedBy: ownerId,
    });

    // The leaked-link case: holding the token is not enough.
    const stolen = await acceptOrgInvitation(db, { token, userId: bystander.id });
    expect(stolen).toEqual({ ok: false, reason: "email_mismatch" });
    // And the invitation survives for its actual recipient.
    expect((await acceptOrgInvitation(db, { token, userId: invitee.id })).ok).toBe(true);
  });

  it("cannot be accepted twice", async () => {
    const invitee = await seedUser(db);
    seededUsers.push(invitee.id);
    const { token } = await createOrgInvitation(db, {
      orgId,
      email: invitee.email,
      role: "viewer",
      invitedBy: ownerId,
    });

    expect((await acceptOrgInvitation(db, { token, userId: invitee.id })).ok).toBe(true);
    expect(await acceptOrgInvitation(db, { token, userId: invitee.id })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("cannot be accepted after revocation", async () => {
    const invitee = await seedUser(db);
    seededUsers.push(invitee.id);
    const { token, id } = await createOrgInvitation(db, {
      orgId,
      email: invitee.email,
      role: "viewer",
      invitedBy: ownerId,
    });

    await revokeOrgInvitation(db, { orgId, invitationId: id });
    expect(await acceptOrgInvitation(db, { token, userId: invitee.id })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("lists only pending invitations, newest first", async () => {
    const isolatedOwner = await seedUser(db);
    seededUsers.push(isolatedOwner.id);
    const isolatedOrg = await seedOrg(db, isolatedOwner.id);
    seededOrgs.push(isolatedOrg.id);

    const kept = await createOrgInvitation(db, {
      orgId: isolatedOrg.id,
      email: "kept@example.test",
      role: "viewer",
      invitedBy: isolatedOwner.id,
    });
    const dropped = await createOrgInvitation(db, {
      orgId: isolatedOrg.id,
      email: "dropped@example.test",
      role: "viewer",
      invitedBy: isolatedOwner.id,
    });
    await revokeOrgInvitation(db, { orgId: isolatedOrg.id, invitationId: dropped.id });

    const pending = await listPendingInvitations(db, isolatedOrg.id);
    expect(pending.map((i) => i.email)).toEqual(["kept@example.test"]);
    expect(pending[0]?.id).toBe(kept.id);
  });
});

describe.skipIf(!hasTestDb)("invitation preview route (requires DB)", () => {
  it("serves a pending invitation publicly and 404s an unknown token", async () => {
    await withDb(async (db) => {
      const owner = await seedUser(db);
      const org = await seedOrg(db, owner.id);
      const { token } = await createOrgInvitation(db, {
        orgId: org.id,
        email: "preview@example.test",
        role: "viewer",
        invitedBy: owner.id,
      });

      // No credentials: the token is the credential.
      const ok = await SELF.fetch(`http://localhost/v1/invitations/${token}`);
      expect(ok.status).toBe(200);
      const body = (await ok.json()) as { orgName: string; email: string };
      expect(body.email).toBe("preview@example.test");
      expect(body.orgName).toBe(org.slug);
      // The preview must not leak the org id or a member roster.
      expect(Object.keys(body).sort()).toEqual(["email", "expiresAt", "orgName", "role"]);

      const missing = await SELF.fetch("http://localhost/v1/invitations/inv_bogus");
      expect(missing.status).toBe(404);

      await cleanup(db, { users: [owner.id], orgs: [org.id] });
    });
  });
});
