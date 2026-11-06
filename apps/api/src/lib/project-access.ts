import type { OrgRole, ProjectRole } from "@skillist/contracts";
import { orgMembers, projectMembers, projects } from "@skillist/db/schema";
import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import type { AuthContext } from "./auth-middleware";
import { inList, type WorkerDb } from "./db";
import { hasMinRole, requireOrgAccess } from "./org-access";

type ProjectRow = typeof projects.$inferSelect;

export type ProjectCapability = "read" | "write" | "manage";

/**
 * The projects a user may read, as a filter over `projects`; null when they
 * belong to no org. Mirrors the REST list route: org owners see every project
 * in their org, everyone else only shared projects or ones they are a member of.
 */
export async function readableProjectsFilter(db: WorkerDb, userId: string): Promise<SQL | null> {
  const memberships = await db
    .select({ orgId: orgMembers.orgId, role: orgMembers.role })
    .from(orgMembers)
    .where(eq(orgMembers.userId, userId));
  if (memberships.length === 0) return null;

  const ownerOrgIds = memberships.filter((m) => m.role === "owner").map((m) => m.orgId);
  const nonOwnerOrgIds = memberships.filter((m) => m.role !== "owner").map((m) => m.orgId);

  const memberProjectIds = db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId));

  const conditions = [];
  if (ownerOrgIds.length > 0) {
    conditions.push(inList(projects.orgId, ownerOrgIds));
  }
  if (nonOwnerOrgIds.length > 0) {
    conditions.push(
      and(
        inList(projects.orgId, nonOwnerOrgIds),
        or(eq(projects.visibility, "shared"), inArray(projects.id, memberProjectIds)),
      ),
    );
  }
  // Never undefined: `.where(undefined)` would drop the filter and expose every project.
  return or(...conditions) ?? null;
}

export type ProjectAccessResult =
  | {
      ok: true;
      project: ProjectRow;
      orgRole: OrgRole;
      projectRole: ProjectRole | null;
      actorId: string | null;
      actorType: "user" | "api_key";
    }
  | { ok: false; status: 401 | 403 | 404 };

/**
 * Resolve whether an actor may perform `capability` on a project.
 *
 * Layered on top of org standing: an actor must first be an org member (via
 * `requireOrgAccess(..., "viewer")`, which also accepts `sk_` API keys). On top
 * of that, project visibility + per-project membership decide the grant.
 *
 * Ordering note: we establish auth/org-standing BEFORE loading the project.
 * This keeps unauthenticated callers on a pure 401 path (no DB round-trip, no
 * project-existence leak); an authenticated org member that names a missing
 * project still gets a 404.
 *
 *   capability | granted when
 *   -----------|--------------------------------------------------------------
 *   read       | orgRole==="owner" OR projectRole != null OR visibility==="shared"
 *   write      | orgRole==="owner" OR projectRole in (editor,admin)
 *              |   OR (visibility==="shared" AND orgRole >= editor)
 *   manage     | orgRole==="owner" OR projectRole==="admin"
 *
 * API-key actors have no project membership (projectRole is always null) and so
 * rely purely on org standing + visibility.
 */
export async function requireProjectAccess(
  db: WorkerDb,
  orgId: string,
  projectId: string,
  auth: AuthContext,
  capability: ProjectCapability,
): Promise<ProjectAccessResult> {
  // 1. Establish actor + org standing (handles sessions and API keys, 401/403).
  // Done first so an unauthenticated caller short-circuits to 401 without a DB
  // read and without learning whether the project exists.
  const access = await requireOrgAccess(db, orgId, auth, "viewer");
  if (!access.ok) return access;
  const orgRole = access.role;
  const isOrgAdmin = orgRole === "owner";

  // 2. Load the project scoped to the org (404 for authenticated members).
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
    .limit(1);
  if (!project) return { ok: false, status: 404 };

  // 3. Per-project membership (users only; API keys never have one).
  let projectRole: ProjectRole | null = null;
  if (access.actorType === "user" && access.actorId) {
    const [member] = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, access.actorId)),
      )
      .limit(1);
    projectRole = (member?.role as ProjectRole | undefined) ?? null;
  }

  const isShared = project.visibility === "shared";

  // 4. Grant by capability.
  let granted = false;
  if (capability === "read") {
    granted = isOrgAdmin || projectRole != null || isShared;
  } else if (capability === "write") {
    granted =
      isOrgAdmin ||
      projectRole === "editor" ||
      projectRole === "admin" ||
      (isShared && hasMinRole(orgRole, "editor"));
  } else {
    // manage
    granted = isOrgAdmin || projectRole === "admin";
  }

  if (!granted) return { ok: false, status: 403 };

  return {
    ok: true,
    project,
    orgRole,
    projectRole,
    actorId: access.actorId,
    actorType: access.actorType,
  };
}

/**
 * Pure write-capability check reused by the list endpoint to compute `canWrite`
 * per row without re-running the full access resolution.
 */
export function canWriteProject(
  orgRole: OrgRole,
  projectRole: ProjectRole | null,
  visibility: string,
): boolean {
  return (
    orgRole === "owner" ||
    projectRole === "editor" ||
    projectRole === "admin" ||
    (visibility === "shared" && hasMinRole(orgRole, "editor"))
  );
}
