import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { organizations, orgMembers, users } from "@skillist/db/schema";
import { and, eq, ne } from "drizzle-orm";
import type { Env } from "../env";
import { logAudit } from "../lib/audit";
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import { errorResponses } from "../lib/openapi";
import { resolveUserId } from "../lib/session";

type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext; db: WorkerDb };
};

export const accountRoutes = new OpenAPIHono<AppEnv>();

/**
 * Orgs that would be left with no owner if this user were deleted.
 *
 * Deleting a user cascades their org_members rows away. For an org where they
 * are the only owner that silently orphans it: the skills, keys, and policies
 * survive with nobody able to administer them. So this is a hard block, and the
 * caller is told which orgs and what to do about it.
 */
async function orgsBlockingDeletion(db: WorkerDb, userId: string) {
  const owned = await db
    .select({ orgId: orgMembers.orgId, slug: organizations.slug, name: organizations.name })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
    .where(and(eq(orgMembers.userId, userId), eq(orgMembers.role, "owner")));

  const blocking: { slug: string; name: string; otherMembers: number }[] = [];
  for (const org of owned) {
    const others = await db
      .select({ id: orgMembers.id, role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, org.orgId), ne(orgMembers.userId, userId)));

    const otherOwners = others.filter((m) => m.role === "owner").length;
    // Another owner exists → the org survives fine.
    if (otherOwners > 0) continue;
    // Sole member of the org → nothing is orphaned; the org goes with them.
    if (others.length === 0) continue;

    blocking.push({ slug: org.slug, name: org.name, otherMembers: others.length });
  }
  return { owned, blocking };
}

const deleteAccountRoute = createRoute({
  method: "delete",
  path: "/account",
  tags: ["Organizations"],
  operationId: "deleteAccount",
  summary: "Permanently delete the signed-in user and their personal data",
  description: [
    "Deletes the user record. Sessions, OAuth accounts, passkeys, and org memberships cascade.",
    "",
    "Orgs where the caller is the **sole owner but not the sole member** block deletion: promote",
    "another owner or remove the other members first. An org where they are the only member is",
    "deleted with them.",
    "",
    "Audit events are deliberately retained — they record who performed privileged actions and",
    "are a security record, not profile data. They reference the user id as plain text, which",
    "survives this deletion.",
    "",
    "Session-authenticated only: an API key cannot delete the human who created it.",
  ].join("\n"),
  responses: {
    200: {
      description: "Account deleted",
      content: {
        "application/json": {
          schema: z.object({ deleted: z.literal(true), orgsDeleted: z.number() }),
        },
      },
    },
    409: {
      description: "Sole owner of an org that has other members",
      content: {
        "application/json": {
          schema: z.object({
            error: z.string(),
            blockingOrgs: z.array(
              z.object({ slug: z.string(), name: z.string(), otherMembers: z.number() }),
            ),
          }),
        },
      },
    },
    ...errorResponses({ notFound: false, conflict: false }),
  },
});

accountRoutes.openapi(deleteAccountRoute, async (c) => {
  // Deliberately NOT requireOrgAccess: this is a personal action, and an API
  // key must not be able to delete its creator's account.
  const userId = await resolveUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  if (c.var.auth.apiKeyId) {
    return c.json({ error: "Account deletion requires a signed-in session, not an API key" }, 403);
  }

  const { owned, blocking } = await orgsBlockingDeletion(c.var.db, userId);
  if (blocking.length > 0) {
    return c.json(
      {
        error:
          "You are the sole owner of an org with other members. Promote another owner, or remove the other members, then try again.",
        blockingOrgs: blocking,
      },
      409,
    );
  }

  // Orgs where this user is the only member go with them. Collected before the
  // delete, because the membership rows are about to cascade away.
  const soloOrgIds: string[] = [];
  for (const org of owned) {
    const others = await c.var.db
      .select({ id: orgMembers.id })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, org.orgId), ne(orgMembers.userId, userId)));
    if (others.length === 0) soloOrgIds.push(org.orgId);
  }

  // Audited BEFORE the delete: audit_events.actor_id is plain text with no FK
  // precisely so this record outlives the user it refers to.
  await logAudit(c.var.db, {
    orgId: null,
    actorId: userId,
    actorType: "user",
    action: "account.delete",
    resourceType: "user",
    resourceId: userId,
    metadata: { orgsDeleted: soloOrgIds.length },
  });

  for (const orgId of soloOrgIds) {
    await c.var.db.delete(organizations).where(eq(organizations.id, orgId));
  }
  await c.var.db.delete(users).where(eq(users.id, userId));

  return c.json({ deleted: true as const, orgsDeleted: soloOrgIds.length }, 200);
});
