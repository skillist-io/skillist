import { organizations, skills, telemetryEvents } from "@skillist/db/schema";
import { buildSkill, createCatalog, type HarnessSkill, type SkillHost } from "@skillist/harness";
import { and, eq } from "drizzle-orm";
import type { Env } from "../env";
import type { AuthContext } from "./auth-middleware";
import type { WorkerDb } from "./db";
import { checkRunQuota, RunQuotaExceededError } from "./run-quota";
import { assertSkillRunAccess } from "./skill-execution-access";
import {
  getPublishedBundle,
  getRunnableScriptsFromBundle,
  runSkillScript,
  SkillExecutionBlockedError,
  SkillExecutionDisabledError,
  SkillNotFoundError,
} from "./skill-runner";

type LoadedSkill = {
  org: typeof organizations.$inferSelect;
  skill: typeof skills.$inferSelect;
  bundle: Map<string, string>;
  harnessSkill: HarnessSkill;
};

function splitRef(ref: string): { org: string; repo: string } | null {
  const parts = ref.split("/");
  const [org, repo] = parts;
  return parts.length === 2 && org && repo ? { org, repo } : null;
}

/**
 * Load one skill for the caller, or null when they can't have it. Unknown,
 * forbidden, unpublished and scan-failed all look the same, so a session can't
 * be used to probe which private skills exist.
 */
async function loadSkill(
  env: Env,
  db: WorkerDb,
  auth: AuthContext,
  ref: string,
): Promise<LoadedSkill | null> {
  const parsed = splitRef(ref);
  if (!parsed) return null;

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, parsed.org))
    .limit(1);
  if (!org) return null;

  const [skill] = await db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, org.id), eq(skills.repo, parsed.repo)))
    .limit(1);
  if (!skill) return null;

  const access = await assertSkillRunAccess(db, auth, org, skill, "view");
  if (!access.ok) return null;

  try {
    const { bundle, version } = await getPublishedBundle(env, db, parsed.org, parsed.repo);
    if (version.securityStatus === "fail") return null;
    const scripts = skill.runtime === "local" ? [] : getRunnableScriptsFromBundle(bundle);
    const harnessSkill = buildSkill(ref, bundle, scripts);
    return harnessSkill ? { org, skill, bundle, harnessSkill } : null;
  } catch (err) {
    if (err instanceof SkillNotFoundError) return null;
    throw err;
  }
}

export type LoadedSession = {
  catalog: ReturnType<typeof createCatalog>;
  host: SkillHost;
  /** Requested refs that didn't load. */
  missing: string[];
};

/**
 * Build a turn's catalog and host from the caller's current access. Runs every
 * turn, so a skill the caller has lost drops out of the session instead of
 * staying reachable through a list fixed at creation.
 */
export async function loadSession(
  env: Env,
  db: WorkerDb,
  auth: AuthContext,
  refs: readonly string[],
  signal?: AbortSignal,
): Promise<LoadedSession> {
  const results = await Promise.all(refs.map((ref) => loadSkill(env, db, auth, ref)));
  const loaded = new Map<string, LoadedSkill>();
  const missing: string[] = [];
  results.forEach((result, index) => {
    const ref = refs[index] as string;
    if (result) loaded.set(ref, result);
    else missing.push(ref);
  });

  const host: SkillHost = {
    readFile: async (ref, path) => loaded.get(ref)?.bundle.get(path) ?? null,

    // Mirrors POST /{org}/{repo}/run: same access check, quota pre-check and
    // runner, so a model can't reach anything the caller couldn't run directly.
    // Every `error` here reaches the model, so each is a fixed code.
    runScript: async (ref, path, args) => {
      const entry = loaded.get(ref);
      const parsed = splitRef(ref);
      if (!entry || !parsed) return { ok: false, error: "unknown_skill" };

      const access = await assertSkillRunAccess(db, auth, entry.org, entry.skill);
      if (!access.ok) return { ok: false, error: "not_permitted" };

      const quota = await checkRunQuota(
        db,
        entry.org.id,
        entry.org.executionPolicy,
        entry.skill.runtime,
        access.isAnonymous,
      );
      if (!quota.ok) return { ok: false, error: "quota_exceeded" };

      try {
        const result = await runSkillScript(env, db, {
          orgSlug: parsed.org,
          skillRepo: parsed.repo,
          scriptPath: path,
          args,
          actorId: access.actorId,
          actorType: access.actorType,
          executionPolicy: entry.org.executionPolicy,
          isAnonymous: access.isAnonymous,
          signal,
        });
        return {
          ok: true,
          runId: result.runId,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        };
      } catch (err) {
        if (err instanceof RunQuotaExceededError) return { ok: false, error: "quota_exceeded" };
        if (err instanceof SkillExecutionBlockedError) {
          return { ok: false, error: "blocked_by_security_scan" };
        }
        if (err instanceof SkillExecutionDisabledError) {
          return { ok: false, error: "execution_disabled" };
        }
        console.error(
          JSON.stringify({
            msg: "harness_script_error",
            ref,
            error: err instanceof Error ? err.name : "unknown",
          }),
        );
        return { ok: false, error: "script_failed" };
      }
    },

    onActivate: async (ref) => {
      const parsed = splitRef(ref);
      if (!parsed) return;
      // Telemetry must never fail the model's tool call.
      try {
        await db.insert(telemetryEvents).values({
          orgSlug: parsed.org,
          skillRepo: parsed.repo,
          eventType: "activation",
          userId: auth.userId,
          apiKeyId: auth.apiKeyId,
        });
      } catch (err) {
        console.error(
          JSON.stringify({
            msg: "harness_telemetry_error",
            error: err instanceof Error ? err.name : "unknown",
          }),
        );
      }
    },
  };

  return {
    catalog: createCatalog([...loaded.values()].map((entry) => entry.harnessSkill)),
    host,
    missing,
  };
}
