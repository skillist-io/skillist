import type { organizations, skills } from "@skillist/db/schema";
import type { AuthContext } from "./auth-middleware";
import type { WorkerDb } from "./db";
import { requireOrgAccess, requireOrgRole } from "./org-access";

export type SkillRunAccess =
  | {
      ok: true;
      actorId: string | null;
      actorType: "user" | "api_key" | "system";
      isAnonymous: boolean;
    }
  | { ok: false; status: 401 | 403 | 404 };

export async function assertSkillRunAccess(
  db: WorkerDb,
  auth: AuthContext,
  org: typeof organizations.$inferSelect,
  skill: typeof skills.$inferSelect,
  mode: "run" | "view" = "run",
): Promise<SkillRunAccess> {
  if (!skill.latestPublishedVersionId) {
    return { ok: false, status: 404 };
  }

  if (skill.visibility === "public") {
    // Public governs READING. Running is a separate question, because a run
    // spends the OWNER org's quota and sandbox compute — so by default only the
    // owning org may run its own public skill, and letting outsiders spend that
    // budget is an explicit opt-in (`allowPublicRuns`). Without this, anyone
    // with an account could burn another org's budget indefinitely, which is
    // denial-of-wallet.
    const allowPublicRuns = org.executionPolicy?.allowPublicRuns === true;

    if (auth.apiKeyId) {
      if (mode === "run") {
        // A `skills:read` key must not be able to trigger compute at all.
        if (!auth.apiKeyScopes.includes("skills:run")) {
          return { ok: false, status: 403 };
        }
        // A key is scoped to exactly one org, so insider status is settled
        // without a query.
        if (auth.apiKeyOrgId !== skill.orgId && !allowPublicRuns) {
          return { ok: false, status: 403 };
        }
      }
      return {
        ok: true,
        actorId: auth.apiKeyCreatedBy,
        actorType: "api_key",
        isAnonymous: false,
      };
    }
    if (auth.userId) {
      // Only pay for the membership lookup when it can change the answer: on a
      // view, or when the owner has already opened runs to everyone, the result
      // is the same either way.
      if (mode === "run" && !allowPublicRuns) {
        const member = await requireOrgRole(db, skill.orgId, auth.userId, "viewer");
        if (!member.ok) return { ok: false, status: 403 };
      }
      return {
        ok: true,
        actorId: auth.userId,
        actorType: "user",
        isAnonymous: false,
      };
    }
    if (mode === "view") {
      return {
        ok: true,
        actorId: null,
        actorType: "system",
        isAnonymous: true,
      };
    }
    return { ok: false, status: 401 };
  }

  const access = await requireOrgAccess(db, skill.orgId, auth, "viewer", {
    apiKeyScope: "skills:run",
  });
  if (!access.ok) return access;

  return {
    ok: true,
    actorId: access.actorId,
    actorType: access.actorType,
    isAnonymous: false,
  };
}
