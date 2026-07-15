import { getSandbox } from "@cloudflare/sandbox";
import { and, eq } from "drizzle-orm";
import {
  organizations,
  skillRuns,
  skills,
  skillVersions,
} from "@skillist/db/schema";
import type { Env } from "../env";
import { logAudit } from "./audit";
import type { WorkerDb } from "./db";
import { downloadBundleFromR2, listBundlePaths } from "./r2";
import {
  buildExecCommand,
  CONTAINER_TIMEOUT_MS,
  EXEC_TIMEOUT_MS,
  listRunnableScripts,
  MAX_OUTPUT_CHARS,
  validateScriptPath,
  validateTargetUrl,
  type SkillRuntime,
} from "./skill-runtime";

export type RunSkillInput = {
  orgSlug: string;
  skillSlug: string;
  scriptPath: string;
  args?: string[];
  targetUrl?: string;
  actorId?: string | null;
  actorType?: "user" | "api_key" | "system";
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
  exec(
    command: string,
    options?: {
      cwd?: string;
      timeout?: number;
      env?: Record<string, string | undefined>;
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
  skillSlug: string,
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
    .where(and(eq(skills.orgId, org.id), eq(skills.slug, skillSlug)))
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
  const bundle = await downloadBundleFromR2(
    env.SKILLS_R2,
    version.r2Prefix,
    paths,
  );

  return { bundle, skill, version };
}

export async function runSkillScript(
  env: Env,
  db: WorkerDb,
  input: RunSkillInput,
): Promise<RunSkillResult> {
  const { orgSlug, skillSlug, scriptPath, args = [], targetUrl } = input;

  if (!validateScriptPath(scriptPath)) {
    throw new Error(
      "scriptPath must be an allowlisted scripts/* file (.sh, .js, .ts, .py)",
    );
  }

  const validatedUrl = validateTargetUrl(targetUrl);
  const { bundle, skill, version } = await getPublishedBundle(
    env,
    db,
    orgSlug,
    skillSlug,
  );

  if (!bundle.has(scriptPath)) {
    throw new Error(`Script not found in bundle: ${scriptPath}`);
  }

  const runtime = skill.runtime;
  if (runtime === "local") {
    throw new Error("This skill has no hosted runtime — install and run locally");
  }

  const [runRow] = await db
    .insert(skillRuns)
    .values({
      skillId: skill.id,
      versionId: version.id,
      orgSlug,
      skillSlug,
      scriptPath,
      runtime,
      status: "running",
      args,
      targetUrl: validatedUrl,
      actorId: input.actorId ?? null,
      actorType: input.actorType ?? "system",
    })
    .returning();

  const runId = runRow!.id;
  const sandboxId = `run-${runId}`;
  const sandbox = getSandbox(
    env.SANDBOX as never,
    sandboxId,
  ) as unknown as SandboxHandle;

  const timeout =
    runtime === "container" ? CONTAINER_TIMEOUT_MS : EXEC_TIMEOUT_MS;

  try {
    await materializeBundle(sandbox, bundle);

    const execArgs = [...args];
    if (validatedUrl && execArgs.length === 0) {
      execArgs.push(validatedUrl);
    }

    const command = buildExecCommand(scriptPath, execArgs);
    const started = Date.now();
    const result = await sandbox.exec(command, {
      cwd: "/workspace",
      timeout,
      env: validatedUrl ? { SKILLIST_TARGET_URL: validatedUrl } : undefined,
    });

    const stdout = truncateOutput(result.stdout ?? "");
    const stderr = truncateOutput(result.stderr ?? "");
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
        skillSlug,
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

export function getRunnableScriptsFromBundle(
  bundle: Map<string, string>,
): string[] {
  return listRunnableScripts(bundle);
}
