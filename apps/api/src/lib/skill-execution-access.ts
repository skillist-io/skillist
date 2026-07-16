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
): Promise<SkillRunAccess> {
  if (!skill.latestPublishedVersionId) {
    return { ok: false, status: 404 };
  }

  if (skill.visibility === "public") {
    if (auth.apiKeyId) {
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
    return {
      ok: true,
      actorId: null,
      actorType: "system",
      isAnonymous: true,
    };
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
