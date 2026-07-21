import { getSandbox } from "@cloudflare/sandbox";
import type { ExecutionPolicy } from "@skillist/contracts";
import { organizations, skillRuns, skills, skillVersions } from "@skillist/db/schema";
import { parsePluginManifest } from "@skillist/skill-format";
import { and, eq } from "drizzle-orm";
import type { Env } from "../env";
import { logAudit } from "./audit";
import type { WorkerDb } from "./db";
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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function truncateOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n…[truncated]`;
}

type SandboxHandle = {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  writeFile(path: string, content: string): Promise<unknown>;
  /** Runtime egress mutator — widens this instance's allowlist for one run. */
  setAllowedHosts(hosts: string[]): Promise<unknown>;
  exec(
    command: string,
    options?: {
      cwd?: string;
      timeout?: number;
      env?: Record<string, string | undefined>;
      stream?: boolean;
      onOutput?: (stream: "stdout" | "stderr", data: string) => void;
      signal?: AbortSignal;
    },
  ): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    success: boolean;
    duration?: number;
  }>;
  destroy(): Promise<unknown>;
};

async function materializeBundle(
  sandbox: SandboxHandle,
  bundle: Map<string, string>,
): Promise<void> {
  await sandbox.mkdir("/workspace", { recursive: true });
  for (const [path, content] of bundle.entries()) {
    const fullPath = `/workspace/${path}`;
    const slash = fullPath.lastIndexOf("/");
    if (slash > "/workspace".length) {
      await sandbox.mkdir(fullPath.slice(0, slash), { recursive: true });
    }
    await sandbox.writeFile(fullPath, content);
    if (path.endsWith(".sh")) {
      await sandbox.exec(`chmod +x ${shellQuote(fullPath)}`);
    }
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
  if (!org) throw new Error("Organization not found");

  const [skill] = await db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, org.id), eq(skills.repo, skillRepo)))
    .limit(1);
  if (!skill || !skill.latestPublishedVersionId) {
    throw new Error("Published skill not found");
  }

  const [version] = await db
    .select()
    .from(skillVersions)
    .where(eq(skillVersions.id, skill.latestPublishedVersionId))
    .limit(1);
  if (!version) throw new Error("Published version not found");

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
  const sandboxBinding = runtime === "container" ? env.SANDBOX_HEAVY : env.SANDBOX;
  const sandbox = getSandbox(sandboxBinding as never, sandboxId) as unknown as SandboxHandle;

  const timeout = runtime === "container" ? CONTAINER_TIMEOUT_MS : EXEC_TIMEOUT_MS;

  // Per-skill least-privilege egress: if the manifest declares network hosts,
  // widen this fresh instance's allowlist to baseline + declared for this run
  // only. Fresh sandbox per run, so nothing leaks to the next tenant. Fail
  // closed — if the mutator errors, the run proceeds on the baseline allowlist
  // (more restrictive), never wide open.
  const declaredHosts = parsePluginManifest(bundle.get("plugin.json") ?? "")?.network?.allowedHosts;
  if (declaredHosts?.length) {
    try {
      await sandbox.setAllowedHosts(resolveRunAllowedHosts(runtime === "container", declaredHosts));
    } catch (err) {
      console.error(
        JSON.stringify({
          msg: "sandbox_set_allowed_hosts_failed",
          runId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  try {
    await materializeBundle(sandbox, bundle);

    const execArgs = [...args];
    if (validatedUrl && execArgs.length === 0) {
      execArgs.push(validatedUrl);
    }

    const command = buildExecCommand(scriptPath, execArgs);
    const started = Date.now();
    const streamChunks: { stdout: string[]; stderr: string[] } = {
      stdout: [],
      stderr: [],
    };
    // Cap what we retain (and forward) live. Without this, a script that emits
    // hundreds of MB (`cat /dev/urandom | base64`) balloons the isolate and
    // floods the SSE stream before the post-run truncateOutput ever applies.
    // The budget spans both streams, matching truncateOutput's per-field cap.
    const forward = input.onOutput;
    let capturedLen = 0;
    let liveTruncated = false;
    const result = await sandbox.exec(command, {
      cwd: "/workspace",
      timeout,
      env: validatedUrl ? { SKILLIST_TARGET_URL: validatedUrl } : undefined,
      stream: !!forward,
      signal: input.signal,
      onOutput: forward
        ? (stream, data) => {
            if (capturedLen >= MAX_OUTPUT_CHARS) return;
            const remaining = MAX_OUTPUT_CHARS - capturedLen;
            const slice = data.length > remaining ? data.slice(0, remaining) : data;
            streamChunks[stream].push(slice);
            capturedLen += slice.length;
            forward(stream, slice);
            if (capturedLen >= MAX_OUTPUT_CHARS && !liveTruncated) {
              liveTruncated = true;
              forward(stream, "\n…[output truncated — limit reached]");
            }
          }
        : undefined,
    });

    const stdout = truncateOutput(result.stdout ?? streamChunks.stdout.join(""));
    const stderr = truncateOutput(result.stderr ?? streamChunks.stderr.join(""));
    const status = result.success ? "completed" : "failed";

    await db
      .update(skillRuns)
      .set({
        status,
        stdout,
        stderr,
        exitCode: result.exitCode,
        durationMs: result.duration ?? Date.now() - started,
        completedAt: new Date(),
      })
      .where(eq(skillRuns.id, runId));

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

    try {
      await sandbox.destroy();
    } catch {
      // best-effort cleanup
    }

    return {
      runId,
      status,
      stdout,
      stderr,
      exitCode: result.exitCode,
      durationMs: result.duration ?? Date.now() - started,
      runtime,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Execution failed";
    await db
      .update(skillRuns)
      .set({
        status: "failed",
        error: message,
        completedAt: new Date(),
      })
      .where(eq(skillRuns.id, runId));

    try {
      await sandbox.destroy();
    } catch {
      // ignore
    }

    throw new Error(message);
  }
}

export function getRunnableScriptsFromBundle(bundle: Map<string, string>): string[] {
  return listRunnableScripts(bundle);
}
