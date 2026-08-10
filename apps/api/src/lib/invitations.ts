import { resolveConsoleUrl } from "@skillist/auth";
import type { OrgRole } from "@skillist/contracts";
import { organizations, orgInvitations, orgMembers, users } from "@skillist/db/schema";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { Env } from "../env";
import { authEnvFromBindings } from "./api-auth";
import type { WorkerDb } from "./db";
import { sha256 } from "./r2";

/**
 * How long an emailed invitation stays redeemable.
 *
 * Longer than a magic link (5 minutes) because an invitation is a scheduling
 * problem, not an authentication one — the recipient may not be at their desk,
 * and a link that dies before they read it just generates support mail. Short
 * enough that a forwarded or archived invite does not stay live indefinitely.
 */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InvitationToken = { token: string; tokenHash: string };

/**
 * Mint an invitation token and its stored hash.
 *
 * Mirrors the API-key construction in routes/orgs.ts: a v4 UUID's 122 bits of
 * CSPRNG entropy, prefixed so the value is recognisable in a support thread,
 * and persisted only as a sha256.
 */
export async function createInvitationToken(): Promise<InvitationToken> {
  const token = `inv_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
  return { token, tokenHash: await sha256(token) };
}

export function hashInvitationToken(token: string): Promise<string> {
  return sha256(token);
}

/** Emails are matched case-insensitively; store and compare one normal form. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function invitationAcceptUrl(env: Env, token: string): string {
  const consoleUrl = resolveConsoleUrl(authEnvFromBindings(env));
  return `${consoleUrl}/invite?token=${encodeURIComponent(token)}`;
}

/**
 * HTML-escape interpolated values.
 *
 * Org names are user-supplied and land in an email body, so they cannot be
 * concatenated into markup raw — a name containing a tag would otherwise let
 * whoever created the org inject content into mail we send in our own name.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildInvitationEmail(params: { orgName: string; role: OrgRole; url: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const { orgName, role, url } = params;
  const safeOrg = escapeHtml(orgName);
  return {
    subject: `You've been invited to ${orgName} on Skillist`,
    html: [
      `<p>You've been invited to join <strong>${safeOrg}</strong> on Skillist as <strong>${role}</strong>.</p>`,
      `<p><a href="${escapeHtml(url)}">Accept the invitation</a></p>`,
      `<p>This invitation expires in 7 days. If you weren't expecting it, you can ignore this email.</p>`,
    ].join("\n"),
    text: [
      `You've been invited to join ${orgName} on Skillist as ${role}.`,
      "",
      `Accept the invitation: ${url}`,
      "",
      "This invitation expires in 7 days. If you weren't expecting it, you can ignore this email.",
    ].join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Invitation lifecycle.
//
// These take a `db` rather than living in the route handlers because user
// sessions cannot be forged over HTTP in the Workers test harness — the same
// reason lib/project-access.ts holds the project authorization matrix. Keeping
// the rules here makes them directly testable against a seeded database.
// ---------------------------------------------------------------------------

/**
 * Invitations that are still redeemable: not accepted, not revoked, not past
 * expiry. Every read applies this, so it lives in one place — a lookup that
 * forgot one of the three would hand out org access.
 */
function pendingInvitation(now: Date) {
  return and(
    isNull(orgInvitations.acceptedAt),
    isNull(orgInvitations.revokedAt),
    gt(orgInvitations.expiresAt, now),
  );
}

/**
 * Create a pending invitation, superseding any earlier one for the same
 * address so the list shows one row per invitee and an older emailed link
 * stops working as soon as a new one is sent.
 *
 * Returns the raw token, which is the only moment it exists in the system —
 * afterwards only its hash is stored.
 */
export async function createOrgInvitation(
  db: WorkerDb,
  params: { orgId: string; email: string; role: OrgRole; invitedBy: string | null; now?: Date },
): Promise<{ id: string; token: string }> {
  const now = params.now ?? new Date();
  const email = normalizeEmail(params.email);
  const { token, tokenHash } = await createInvitationToken();

  await db
    .update(orgInvitations)
    .set({ revokedAt: now })
    .where(
      and(
        eq(orgInvitations.orgId, params.orgId),
        eq(orgInvitations.email, email),
        isNull(orgInvitations.acceptedAt),
        isNull(orgInvitations.revokedAt),
      ),
    );

  const [invitation] = await db
    .insert(orgInvitations)
    .values({
      orgId: params.orgId,
      email,
      role: params.role,
      tokenHash,
      invitedBy: params.invitedBy,
      expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
    })
    .returning({ id: orgInvitations.id });
  if (!invitation) throw new Error("invitation insert returned no row");

  return { id: invitation.id, token };
}

export type InvitationPreviewRow = {
  orgName: string;
  email: string;
  role: OrgRole;
  expiresAt: Date;
};

/** Resolve a raw token to its still-pending invitation, or null. */
export async function findPendingInvitation(
  db: WorkerDb,
  token: string,
  now: Date = new Date(),
): Promise<InvitationPreviewRow | null> {
  const [row] = await db
    .select({
      email: orgInvitations.email,
      role: orgInvitations.role,
      expiresAt: orgInvitations.expiresAt,
      orgName: organizations.name,
    })
    .from(orgInvitations)
    .innerJoin(organizations, eq(organizations.id, orgInvitations.orgId))
    .where(
      and(eq(orgInvitations.tokenHash, await hashInvitationToken(token)), pendingInvitation(now)),
    )
    .limit(1);
  return row ? { ...row, role: row.role as OrgRole } : null;
}

export async function listPendingInvitations(
  db: WorkerDb,
  orgId: string,
  now: Date = new Date(),
): Promise<{ id: string; email: string; role: OrgRole; expiresAt: Date; createdAt: Date }[]> {
  const rows = await db
    .select({
      id: orgInvitations.id,
      email: orgInvitations.email,
      role: orgInvitations.role,
      expiresAt: orgInvitations.expiresAt,
      createdAt: orgInvitations.createdAt,
    })
    .from(orgInvitations)
    .where(and(eq(orgInvitations.orgId, orgId), pendingInvitation(now)))
    .orderBy(desc(orgInvitations.createdAt));
  return rows.map((row) => ({ ...row, role: row.role as OrgRole }));
}

/**
 * Revoke a pending invitation. Scoped by orgId as well as id so an owner of one
 * org cannot revoke another org's invitation by guessing its id.
 */
export async function revokeOrgInvitation(
  db: WorkerDb,
  params: { orgId: string; invitationId: string; now?: Date },
): Promise<{ id: string; email: string } | null> {
  const now = params.now ?? new Date();
  const [revoked] = await db
    .update(orgInvitations)
    .set({ revokedAt: now })
    .where(
      and(
        eq(orgInvitations.id, params.invitationId),
        eq(orgInvitations.orgId, params.orgId),
        pendingInvitation(now),
      ),
    )
    .returning({ id: orgInvitations.id, email: orgInvitations.email });
  return revoked ?? null;
}

export type AcceptResult =
  | { ok: true; orgId: string; orgSlug: string; role: OrgRole }
  | { ok: false; reason: "not_found" | "email_mismatch" };

/**
 * Redeem a token and join the org.
 *
 * The token alone is not sufficient: the accepting user's email must match the
 * address the inviter named, so a link that leaks (forwarded mail, a shared
 * inbox) still cannot be redeemed by a different account.
 */
export async function acceptOrgInvitation(
  db: WorkerDb,
  params: { token: string; userId: string; now?: Date },
): Promise<AcceptResult> {
  const now = params.now ?? new Date();
  const tokenHash = await hashInvitationToken(params.token);

  const [invitation] = await db
    .select()
    .from(orgInvitations)
    .where(and(eq(orgInvitations.tokenHash, tokenHash), pendingInvitation(now)))
    .limit(1);
  if (!invitation) return { ok: false, reason: "not_found" };

  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, params.userId))
    .limit(1);
  if (!user || normalizeEmail(user.email) !== invitation.email) {
    return { ok: false, reason: "email_mismatch" };
  }

  const [org] = await db
    .select({ id: organizations.id, slug: organizations.slug })
    .from(organizations)
    .where(eq(organizations.id, invitation.orgId))
    .limit(1);
  if (!org) return { ok: false, reason: "not_found" };

  // Stamp the invitation first, and only if it is still pending. Two clicks on
  // the same link race here; the loser's update matches no row and stops, so
  // the membership insert runs exactly once.
  const [claimed] = await db
    .update(orgInvitations)
    .set({ acceptedAt: now })
    .where(and(eq(orgInvitations.id, invitation.id), pendingInvitation(now)))
    .returning({ id: orgInvitations.id });
  if (!claimed) return { ok: false, reason: "not_found" };

  await db
    .insert(orgMembers)
    .values({ orgId: invitation.orgId, userId: params.userId, role: invitation.role })
    .onConflictDoNothing();

  return { ok: true, orgId: org.id, orgSlug: org.slug, role: invitation.role as OrgRole };
}
