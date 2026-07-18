import type { organizations, skills } from "@skillist/db/schema";
import type { AuthContext } from "./auth-middleware";
import type { WorkerDb } from "./db";
import { requireOrgAccess } from "./org-access";

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
  _org: typeof organizations.$inferSelect,
  skill: typeof skills.$inferSelect,
  mode: "run" | "view" = "run",
): Promise<SkillRunAccess> {
  if (!skill.latestPublishedVersionId) {
    return { ok: false, status: 404 };
  }

  if (skill.visibility === "public") {
    if (auth.apiKeyId) {
      // Running a public skill still consumes the OWNER org's quota and sandbox
      // compute, so an API key must explicitly carry `skills:run` to trigger a
      // run — a `skills:read` key must not be able to burn another org's budget
      // (denial-of-wallet). Viewing is free and stays open to any valid key.
      if (mode === "run" && !auth.apiKeyScopes.includes("skills:run")) {
        return { ok: false, status: 403 };
      }
      return {
        ok: true,
        actorId: auth.apiKeyCreatedBy,
        actorType: "api_key",
        isAnonymous: false,
      };
    }
    if (auth.userId) {
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
