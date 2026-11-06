import type { ExecutionPolicy } from "@skillist/contracts";
import { organizations, skillRuns, skills, skillVersions } from "@skillist/db/schema";
import { parsePluginManifest } from "@skillist/skill-format";
import { and, eq } from "drizzle-orm";
import type { SkillSandbox } from "../durable-objects/skill-sandbox";
import type { Env } from "../env";
import { logAudit } from "./audit";
import type { WorkerDb } from "./db";
import { persistableErrorMessage } from "./error-detail";
import { downloadBundleFromR2, listBundlePaths } from "./r2";
import { reserveRunSlot } from "./run-quota";
import { resolveRunAllowedHosts } from "./sandbox-egress";
import {
  buildExecCommand,
  CONTAINER_TIMEOUT_MS,
  EXEC_TIMEOUT_MS,
  listRunnableScripts,
  MAX_OUTPUT_CHARS,
  type SkillRuntime,
  sliceText,
  validateScriptPath,
  validateTargetUrl,
} from "./skill-runtime";

export type RunSkillInput = {
  orgSlug: string;
  skillRepo: string;
  scriptPath: string;
  args?: string[];
  targetUrl?: string;
  actorId?: string | null;
  actorType?: "user" | "api_key" | "system";
  onOutput?: (stream: "stdout" | "stderr", chunk: string) => void;
  /** Aborted when the client disconnects, so a hosted run doesn't outlive its reader. */
  signal?: AbortSignal;
  /** Owner org's execution policy, used for the atomic quota reservation. */
  executionPolicy?: ExecutionPolicy | null;
  /** True for unauthenticated public-skill runs, for the anonymous sub-limit. */
  isAnonymous?: boolean;
};

export type RunSkillResult = {
  runId: string;
  status: "completed" | "failed";
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  runtime: SkillRuntime;
};

/**
 * Thrown when a published version is refused execution because it failed its
 * security scan. Kept distinct from validation/quota errors so the route can map
 * it to a 403 rather than a generic 400.
 */
export class SkillExecutionBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillExecutionBlockedError";
  }
}

function truncateOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${sliceText(text, MAX_OUTPUT_CHARS)}\n…[truncated]`;
}

type SandboxHandle = Pick<
  SkillSandbox,
  "start" | "mkdir" | "writeFile" | "makeExecutable" | "run" | "destroy"
>;

async function materializeBundle(
  sandbox: SandboxHandle,
  bundle: Map<string, string>,
): Promise<void> {
  await sandbox.mkdir("/workspace");
  for (const [path, content] of bundle.entries()) {
    const fullPath = `/workspace/${path}`;
    const slash = fullPath.lastIndexOf("/");
    if (slash > "/workspace".length) {
      await sandbox.mkdir(fullPath.slice(0, slash));
    }
    await sandbox.writeFile(fullPath, content);
    if (path.endsWith(".sh")) {
      await sandbox.makeExecutable(fullPath);
    }
  }
}

/**
 * The skill (or its org/published version) genuinely does not exist.
 *
 * Typed so a caller's catch can answer 404 for *this* and let everything else
 * propagate. Without the distinction a dropped database connection inside the
 * lookups below is indistinguishable from a missing row, and gets answered as a
 * 404 whose body is the raw failing SQL.
 */
export class SkillNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillNotFoundError";
  }
}

export async function getPublishedBundle(
  env: Env,
  db: WorkerDb,
  orgSlug: string,
  skillRepo: string,
): Promise<{
  bundle: Map<string, string>;
  skill: typeof skills.$inferSelect;
  version: typeof skillVersions.$inferSelect;
}> {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, orgSlug))
    .limit(1);
  if (!org) throw new SkillNotFoundError("Organization not found");

  const [skill] = await db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, org.id), eq(skills.repo, skillRepo)))
    .limit(1);
  if (!skill || !skill.latestPublishedVersionId) {
    throw new SkillNotFoundError("Published skill not found");
  }

  const [version] = await db
    .select()
    .from(skillVersions)
    .where(eq(skillVersions.id, skill.latestPublishedVersionId))
    .limit(1);
  if (!version) throw new SkillNotFoundError("Published version not found");

  const paths = await listBundlePaths(env.SKILLS_R2, version.r2Prefix);
  const bundle = await downloadBundleFromR2(env.SKILLS_R2, version.r2Prefix, paths);

  return { bundle, skill, version };
}

export async function runSkillScript(
  env: Env,
  db: WorkerDb,
  input: RunSkillInput,
): Promise<RunSkillResult> {
  const { orgSlug, skillRepo, scriptPath, args = [], targetUrl } = input;

  if (!validateScriptPath(scriptPath)) {
    throw new Error("scriptPath must be an allowlisted scripts/* file (.sh, .js, .ts, .py)");
  }

  const validatedUrl = validateTargetUrl(targetUrl);
  const { bundle, skill, version } = await getPublishedBundle(env, db, orgSlug, skillRepo);

  // Defense-in-depth: the run path must re-check the stored security posture, not
  // just trust that publishing gated on it. A version whose scan hard-failed
  // (e.g. published before the policy existed, or via a path that skipped it) is
  // refused execution outright. `advisory` (medium-severity) stays runnable —
  // it's surfaced as reduced-trust, not blocked — and an unscanned/null status
  // is not treated as a failure.
  if (version.securityStatus === "fail") {
    throw new SkillExecutionBlockedError(
      "This skill version failed its security scan and cannot be executed",
    );
  }

  if (!bundle.has(scriptPath)) {
    throw new Error(`Script not found in bundle: ${scriptPath}`);
  }

  const runtime = skill.runtime;
  if (runtime === "local") {
    throw new Error("This skill has no hosted runtime — install and run locally");
  }

  // Atomically re-check quota and insert the reservation row in one advisory-
  // locked transaction. This is the authoritative gate; the pre-check in the
  // route handler only rejects the obvious cases early. Throws
  // RunQuotaExceededError when over limit, which the caller maps to a 429.
  const runRow = await reserveRunSlot(db, {
    orgId: skill.orgId,
    policy: input.executionPolicy,
    runtime,
    isAnonymous: input.isAnonymous ?? false,
    values: {
      skillId: skill.id,
      versionId: version.id,
      orgSlug,
      skillRepo,
      scriptPath,
      runtime,
      status: "running",
      args,
      targetUrl: validatedUrl,
      actorId: input.actorId ?? null,
      actorType: input.actorType ?? "system",
    },
  });

  const runId = runRow.id;
  const sandboxId = `run-${runId}`;
  const isHeavy = runtime === "container";
  const sandbox: SandboxHandle = (isHeavy ? env.SANDBOX_HEAVY : env.SANDBOX).getByName(
    sandboxId,
  ) as unknown as SandboxHandle;

  const timeout = isHeavy ? CONTAINER_TIMEOUT_MS : EXEC_TIMEOUT_MS;

  // Per-skill least-privilege egress: baseline plus whatever the manifest declares.
  const declaredHosts =
    parsePluginManifest(bundle.get("plugin.json") ?? "")?.network?.allowedHosts ?? [];

  const destroySandbox = () => sandbox.destroy().catch(() => {});

  // Destroying the container is the only way to stop a run from out here. The
  // in-flight `run` then resolves with exit code 137, so it's recorded as failed.
  const cancel = () => void destroySandbox();
  input.signal?.addEventListener("abort", cancel, { once: true });

  // The listener can't help before the container exists: destroying nothing does
  // nothing, and a signal that already fired never fires again. So setup checks too.
  const stopIfCancelled = () => {
    if (input.signal?.aborted) throw new Error("Run cancelled");
  };

  try {
    // Inside the try so a failed start is recorded as a failed run. The hosts are
    // fixed here, before any skill code exists in the container.
    stopIfCancelled();
    await sandbox.start(resolveRunAllowedHosts(isHeavy, declaredHosts));
    stopIfCancelled();
    await materializeBundle(sandbox, bundle);
    stopIfCancelled();

    const execArgs = [...args];
    if (validatedUrl && execArgs.length === 0) {
      execArgs.push(validatedUrl);
    }

    const command = buildExecCommand(scriptPath, execArgs);
    const forward = input.onOutput;
    const result = await sandbox.run({
      command,
      cwd: "/workspace",
      timeoutMs: timeout,
      env: validatedUrl ? { SKILLIST_TARGET_URL: validatedUrl } : undefined,
      onOutput: forward,
    });
    await destroySandbox();

    const stdout = truncateOutput(result.stdout);
    const stderr = truncateOutput(
      result.timedOut
        ? `${result.stderr}\n…[stopped after reaching the ${timeout / 1000}s time limit]`
        : result.stderr,
    );
    const status = result.exitCode === 0 ? "completed" : "failed";

    await db
      .update(skillRuns)
      .set({
        status,
        stdout,
        stderr,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        completedAt: new Date(),
      })
      .where(eq(skillRuns.id, runId));

    // The run already finished and is recorded. A failed audit write must not
    // flip it to failed in the catch below.
    try {
      await logAudit(db, {
        orgId: skill.orgId,
        actorId: input.actorId,
        actorType: input.actorType ?? "system",
        action: "skill.script.executed",
        resourceType: "skill_run",
        resourceId: runId,
        metadata: {
          orgSlug,
          skillRepo,
          scriptPath,
          exitCode: result.exitCode,
          runtime,
        },
      });
    } catch (err) {
      console.error(
        JSON.stringify({
          msg: "skill_run_audit_failed",
          runId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }

    return {
      runId,
      status,
      stdout,
      stderr,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      runtime,
    };
  } catch (err) {
    // First, so a failing database can't leave the container running.
    await destroySandbox();

    // `skill_runs.error` is rendered in the console run history, so a database
    // failure here would durably park raw SQL in a user-visible column.
    const message = persistableErrorMessage(err, "Execution failed");
    await db
      .update(skillRuns)
      .set({
        status: "failed",
        error: message,
        completedAt: new Date(),
      })
      .where(eq(skillRuns.id, runId));

    throw new Error(message);
  } finally {
    input.signal?.removeEventListener("abort", cancel);
  }
}

export function getRunnableScriptsFromBundle(bundle: Map<string, string>): string[] {
  return listRunnableScripts(bundle);
}
