import type { ApiKeyScope, OrgRole } from "@skillist/contracts";
import { orgMembers } from "@skillist/db/schema";
import { and, eq } from "drizzle-orm";
import type { AuthContext } from "./auth-middleware";
import type { WorkerDb } from "./db";

const ROLE_RANK: Record<OrgRole, number> = {
  viewer: 1,
  publisher: 2,
  editor: 3,
  owner: 4,
};

const SCOPE_MIN_ROLE: Record<ApiKeyScope, OrgRole> = {
  "skills:read": "viewer",
  "skills:run": "viewer",
  "skills:write": "editor",
  "skills:publish": "publisher",
  "feedback:submit": "publisher",
  "feedback:approve": "owner",
};

export type OrgAccessResult =
  | { ok: true; role: OrgRole; actorId: string | null; actorType: "user" | "api_key" }
  | { ok: false; status: 401 | 403 };

export async function getOrgMembership(db: WorkerDb, orgId: string, userId: string) {
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

export async function requireOrgAccess(
  db: WorkerDb,
  orgId: string,
  auth: AuthContext,
  minRole: OrgRole,
  options?: { apiKeyScope?: ApiKeyScope },
): Promise<OrgAccessResult> {
  if (auth.apiKeyId) {
    if (!auth.apiKeyOrgId || auth.apiKeyOrgId !== orgId) {
      return { ok: false, status: 403 };
    }
    if (options?.apiKeyScope && !auth.apiKeyScopes.includes(options.apiKeyScope)) {
      return { ok: false, status: 403 };
    }
    const scopeRole = options?.apiKeyScope ? SCOPE_MIN_ROLE[options.apiKeyScope] : "viewer";
    if (!hasMinRole(scopeRole, minRole)) {
      return { ok: false, status: 403 };
    }
    return {
      ok: true,
      role: scopeRole,
      actorId: auth.apiKeyCreatedBy,
      actorType: "api_key",
    };
  }

  if (!auth.userId) return { ok: false, status: 401 };
  const memberAccess = await requireOrgRole(db, orgId, auth.userId, minRole);
  if (!memberAccess.ok) return memberAccess;
  return {
    ok: true,
    role: memberAccess.role,
    actorId: auth.userId,
    actorType: "user",
  };
}
