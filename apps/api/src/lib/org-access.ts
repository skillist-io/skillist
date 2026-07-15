import { and, eq } from "drizzle-orm";
import { orgMembers } from "@skillist/db/schema";
import type { OrgRole } from "@skillist/contracts";
import type { WorkerDb } from "./db";

const ROLE_RANK: Record<OrgRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

export async function getOrgMembership(
  db: WorkerDb,
  orgId: string,
  userId: string,
) {
  const [member] = await db
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1);
  if (!member) return null;
  return member;
}

export function hasMinRole(role: OrgRole, minRole: OrgRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

export async function requireOrgRole(
  db: WorkerDb,
  orgId: string,
  userId: string | null,
  minRole: OrgRole,
): Promise<{ ok: true; role: OrgRole } | { ok: false; status: 401 | 403 }> {
  if (!userId) return { ok: false, status: 401 };
  const [member] = await db
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1);
  if (!member) {
    return { ok: false, status: 403 };
  }
  if (!hasMinRole(member.role as OrgRole, minRole)) {
    return { ok: false, status: 403 };
  }
  return { ok: true, role: member.role as OrgRole };
}
