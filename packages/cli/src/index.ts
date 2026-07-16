#!/usr/bin/env node
import { readdir, readFile, writeFile, mkdir, access } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import { validateSkillBundle } from "@skillist/skill-format";

const API_URL = process.env.SKILLIST_API_URL ?? "https://api.skillist.dev";
const API_KEY = process.env.SKILLIST_API_KEY;
const LOCKFILE = ".skillist.lock";

type LockEntry = {
  org: string;
  skill: string;
  version: string;
  installedAt: string;
  path: string;
};

type Lockfile = {
  version: 1;
  skills: LockEntry[];
};

function usage() {
  console.log(`Skillist CLI — sync agent skills with skillist.dev

Usage:
  skillist search [query]                  Search public registry
  skillist install <org>/<skill> [-o dir]  Download and record in lockfile
  skillist pull <org>/<skill> [-o dir]     Download published skill bundle
  skillist push <org>/<skill> <dir>        Upload local skill as new draft
  skillist publish <org>/<skill> <dir>       Push + publish to registry
  skillist run <org>/<skill> --script <path>   Run script in hosted sandbox
                                              [--url <url>] [--stream] [-- ...args]
  skillist eval <org>/<skill>                 Queue skill eval on latest draft
                                              [--wait]
  skillist update [org/skill]              Update installed skills from lockfile
  skillist list                            List skills in lockfile

Environment:
  SKILLIST_API_URL   API base URL (default: https://api.skillist.dev)
  SKILLIST_API_KEY   Bearer token (sk_...) — required for push/publish
`);
}

function parseRef(ref: string): { org: string; skill: string } {
  const [org, skill] = ref.split("/");
  if (!org || !skill) {
    throw new Error(`Invalid ref "${ref}" — use org/skill`);
  }
  return { org, skill };
}

async function apiFetch(path: string, init?: RequestInit) {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
  };
  if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res;
}

async function readLockfile(): Promise<Lockfile> {
  try {
    await access(LOCKFILE);
    const raw = await readFile(LOCKFILE, "utf8");
    return JSON.parse(raw) as Lockfile;
  } catch {
    return { version: 1, skills: [] };
  }
}

async function writeLockfile(lock: Lockfile) {
  await writeFile(LOCKFILE, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

async function recordTelemetry(org: string, skill: string, eventType: "install" | "activation") {
  try {
    await apiFetch("/v1/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgSlug: org, skillSlug: skill, eventType }),
    });
  } catch {
    // telemetry is best-effort
  }
}

async function search(query: string, options: { category?: string; tag?: string } = {}) {
  const params = new URLSearchParams({ limit: "20" });
  if (query) params.set("q", query);
  if (options.category) params.set("category", options.category);
  if (options.tag) params.set("tag", options.tag);
  const res = await apiFetch(`/v1/registry?${params}`);
  const data = (await res.json()) as {
    items: {
      orgSlug: string;
      skillSlug: string;
      name: string;
      description: string;
      latestVersion: string | null;
      qualityScore: number | null;
      impactScore: number | null;
      securityStatus: string | null;
      category?: string | null;
      tags?: string[];
      installCommand?: string;
    }[];
    total: number;
  };

  if (data.items.length === 0) {
    console.log("No skills found.");
    return;
  }

  for (const item of data.items) {
    const scores = [
      item.qualityScore != null ? `Q${item.qualityScore}` : null,
      item.impactScore != null ? `I${item.impactScore}` : null,
      item.securityStatus ? `S:${item.securityStatus}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    const tags = item.tags?.length ? ` [${item.tags.join(", ")}]` : "";
    console.log(
      `${item.orgSlug}/${item.skillSlug}  ${item.name}  v${item.latestVersion ?? "?"}  ${scores}${tags}`,
    );
    console.log(`  ${item.description.slice(0, 100)}`);
    console.log(`  ${item.installCommand ?? `skillist install ${item.orgSlug}/${item.skillSlug}`}`);
    console.log();
  }
  console.log(`${data.total} total matches`);
}

async function pull(ref: string, outDir: string, recordLock = false) {
  const { org, skill } = parseRef(ref);
  const res = await apiFetch(`/v1/skills/${org}/${skill}/bundle`);
  const bundle = (await res.json()) as { files: Record<string, string>; version: string };

  await mkdir(outDir, { recursive: true });
  for (const [path, content] of Object.entries(bundle.files)) {
    const filePath = join(outDir, path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
  }

  if (recordLock) {
    const lock = await readLockfile();
    const existing = lock.skills.findIndex(
      (s) => s.org === org && s.skill === skill,
    );
    const entry: LockEntry = {
      org,
      skill,
      version: bundle.version,
      installedAt: new Date().toISOString(),
      path: outDir,
    };
    if (existing >= 0) lock.skills[existing] = entry;
    else lock.skills.push(entry);
    await writeLockfile(lock);
    await recordTelemetry(org, skill, "install");
  }

  console.log(
    `Pulled ${org}/${skill} → ${outDir} (${Object.keys(bundle.files).length} files, v${bundle.version})`,
  );
}

async function readLocalBundle(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();

  async function walk(current: string, prefix: string) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = join(current, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else {
        files.set(rel, await readFile(full, "utf8"));
      }
    }
  }

  await walk(dir, "");
  return files;
}

async function resolveOrgId(orgSlug: string): Promise<string> {
  const orgsRes = await apiFetch("/v1/orgs");
  const orgs = (await orgsRes.json()) as { id: string; slug: string }[];
  const orgRecord = orgs.find((o) => o.slug === orgSlug);
  if (!orgRecord) {
    throw new Error(`Org "${orgSlug}" not found — create it in the dashboard first`);
  }
  return orgRecord.id;
}

async function pushDraft(
  org: string,
  skill: string,
  dir: string,
): Promise<{ versionId: string; orgId: string }> {
  const fileMap = await readLocalBundle(dir);
  const files = Object.fromEntries(fileMap);
  const bundle = new Map(Object.entries(files));
  const validation = validateSkillBundle(bundle, skill);
  if (!validation.valid) {
    throw new Error(
      `Invalid skill: ${validation.errors.map((e) => e.message).join(", ")}`,
    );
  }

  const orgId = await resolveOrgId(org);

  const versionsRes = await apiFetch(`/v1/orgs/${orgId}/skills/${skill}/versions`);
  const versions = (await versionsRes.json()) as { id: string; status: string }[];
  const latest = versions.find((v) => v.status === "draft") ?? versions[0];

  const uploadRes = await apiFetch(`/v1/orgs/${orgId}/skills/${skill}/versions`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files,
      parentVersionId: latest?.id,
    }),
  });
  const uploaded = (await uploadRes.json()) as { id: string };

  return { versionId: uploaded.id, orgId };
}

async function push(ref: string, dir: string) {
  if (!API_KEY) throw new Error("SKILLIST_API_KEY is required for push");
  const { org, skill } = parseRef(ref);
  await pushDraft(org, skill, dir);
  console.log(`Pushed ${relative(process.cwd(), dir)} → ${org}/${skill}`);
}

async function publish(ref: string, dir: string) {
  if (!API_KEY) throw new Error("SKILLIST_API_KEY is required for publish");
  const { org, skill } = parseRef(ref);
  const { versionId, orgId } = await pushDraft(org, skill, dir);

  const pubRes = await apiFetch(
    `/v1/orgs/${orgId}/skills/${skill}/versions/${versionId}/publish`,
    { method: "POST" },
  );
  const result = (await pubRes.json()) as {
    version: string;
    qualityScore: number;
    impactScore: number;
    securityStatus: string;
  };

  console.log(
    `Published ${org}/${skill} v${result.version} — Q${result.qualityScore} I${result.impactScore} security:${result.securityStatus}`,
  );
}

async function update(ref?: string) {
  const lock = await readLockfile();
  const targets = ref
    ? lock.skills.filter((s) => `${s.org}/${s.skill}` === ref)
    : lock.skills;

  if (targets.length === 0) {
    console.log(ref ? `No lockfile entry for ${ref}` : "Lockfile is empty — run install first");
    return;
  }

  for (const entry of targets) {
    await pull(`${entry.org}/${entry.skill}`, entry.path, true);
  }
}

async function listInstalled() {
  const lock = await readLockfile();
  if (lock.skills.length === 0) {
    console.log("No installed skills in .skillist.lock");
    return;
  }
  for (const s of lock.skills) {
    console.log(
      `${s.org}/${s.skill}  v${s.version}  ${s.path}  (${s.installedAt.slice(0, 10)})`,
    );
  }
}

async function parseSseRun(response: Response): Promise<{
  runId: string;
  status: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  runtime: string;
}> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");
  const decoder = new TextDecoder();
  let buffer = "";
  let result: {
    runId: string;
    status: string;
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
    runtime: string;
  } | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const lines = part.split("\n");
      let event = "message";
      let data = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) event = line.slice(7);
        if (line.startsWith("data: ")) data = line.slice(6);
      }
      if (!data) continue;
      const payload = JSON.parse(data) as Record<string, unknown>;
      if (event === "output") {
        const chunk = String(payload.chunk ?? "");
        if (payload.stream === "stderr") process.stderr.write(chunk);
        else process.stdout.write(chunk);
      } else if (event === "done") {
        result = payload as unknown as NonNullable<typeof result>;
      } else if (event === "error") {
        throw new Error(String(payload.message ?? "Execution failed"));
      }
    }
  }

  if (!result) throw new Error("Stream ended without result");
  return result;
}

async function runSkill(
  ref: string,
  scriptPath: string,
  targetUrl?: string,
  extraArgs: string[] = [],
  stream = false,
) {
  const { org, skill } = parseRef(ref);
  const res = await apiFetch(`/v1/skills/${org}/${skill}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scriptPath,
      targetUrl,
      args: extraArgs,
      stream,
    }),
  });

  const result =
    stream && res.headers.get("content-type")?.includes("text/event-stream")
      ? await parseSseRun(res)
      : ((await res.json()) as {
          runId: string;
          status: string;
          stdout: string;
          stderr: string;
          exitCode: number;
          durationMs: number;
          runtime: string;
        });

  if (!stream) {
    console.log(
      `Run ${result.runId} (${result.runtime}) — ${result.status} exit ${result.exitCode} (${result.durationMs}ms)`,
    );
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);
  } else {
    console.error(
      `\nRun ${result.runId} (${result.runtime}) — ${result.status} exit ${result.exitCode} (${result.durationMs}ms)`,
    );
  }
  if (result.exitCode !== 0) process.exit(result.exitCode);
}

async function runEval(ref: string, wait = false) {
  if (!API_KEY) throw new Error("SKILLIST_API_KEY is required for eval");
  const { org, skill } = parseRef(ref);
  const orgId = await resolveOrgId(org);

  const versionsRes = await apiFetch(`/v1/orgs/${orgId}/skills/${skill}/versions`);
  const versions = (await versionsRes.json()) as { id: string; status: string }[];
  const draft = versions.find((v) => v.status === "draft") ?? versions[0];
  if (!draft) throw new Error(`No versions found for ${org}/${skill}`);

  const evalRes = await apiFetch(
    `/v1/orgs/${orgId}/skills/${skill}/versions/${draft.id}/eval`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  const { eval: queued } = (await evalRes.json()) as {
    eval: { id: string; status: string };
  };
  console.log(`Eval queued: ${queued.id}`);

  if (!wait) return;

  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((r) => setTimeout(r, 3000));
    const detailRes = await apiFetch(
      `/v1/orgs/${orgId}/skills/${skill}/evals/${queued.id}`,
    );
    const { eval: detail } = (await detailRes.json()) as {
      eval: {
        status: string;
        baselineScore: number | null;
        withSkillScore: number | null;
        uplift: number | null;
        error?: string | null;
      };
    };
    if (detail.status === "completed") {
      console.log(
        `Eval complete: ${detail.baselineScore} → ${detail.withSkillScore} (+${detail.uplift ?? 0})`,
      );
      return;
    }
    if (detail.status === "failed") {
      throw new Error(detail.error ?? "Eval failed");
    }
    process.stderr.write(".");
  }
  throw new Error("Eval timed out");
}

async function main() {
  const [, , cmd, ref, arg] = process.argv;

  if (!cmd || cmd === "help" || cmd === "--help") {
    usage();
    return;
  }

  try {
    if (cmd === "search") {
      const categoryIdx = process.argv.indexOf("--category");
      const tagIdx = process.argv.indexOf("--tag");
      await search(ref ?? "", {
        category: categoryIdx >= 0 ? process.argv[categoryIdx + 1] : undefined,
        tag: tagIdx >= 0 ? process.argv[tagIdx + 1] : undefined,
      });
      return;
    }

    if (cmd === "install") {
      const outIdx = process.argv.indexOf("-o");
      const outDir =
        outIdx >= 0
          ? process.argv[outIdx + 1]!
          : `./${ref?.split("/")[1] ?? "skill"}`;
      if (!ref) throw new Error("Missing org/skill ref");
      await pull(ref, outDir, true);
      return;
    }

    if (cmd === "pull") {
      const outIdx = process.argv.indexOf("-o");
      const outDir =
        outIdx >= 0
          ? process.argv[outIdx + 1]!
          : `./${ref?.split("/")[1] ?? "skill"}`;
      if (!ref) throw new Error("Missing org/skill ref");
      await pull(ref, outDir);
      return;
    }

    if (cmd === "push") {
      if (!ref || !arg) throw new Error("Usage: skillist push <org>/<skill> <dir>");
      await push(ref, arg);
      return;
    }

    if (cmd === "publish") {
      if (!ref || !arg) throw new Error("Usage: skillist publish <org>/<skill> <dir>");
      await publish(ref, arg);
      return;
    }

    if (cmd === "update") {
      await update(ref);
      return;
    }

    if (cmd === "list") {
      await listInstalled();
      return;
    }

    if (cmd === "run") {
      if (!ref) throw new Error("Usage: skillist run <org>/<skill> --script <path> [--url <url>] [-- ...args]");
      const scriptIdx = process.argv.indexOf("--script");
      const urlIdx = process.argv.indexOf("--url");
      const dashIdx = process.argv.indexOf("--");
      if (scriptIdx < 0) throw new Error("--script is required");
      const scriptPath = process.argv[scriptIdx + 1]!;
      const targetUrl = urlIdx >= 0 ? process.argv[urlIdx + 1] : undefined;
      const extraArgs = dashIdx >= 0 ? process.argv.slice(dashIdx + 1) : [];
      const stream = process.argv.includes("--stream");
      await runSkill(ref, scriptPath, targetUrl, extraArgs, stream);
      return;
    }

    if (cmd === "eval") {
      if (!ref) throw new Error("Usage: skillist eval <org>/<skill> [--wait]");
      await runEval(ref, process.argv.includes("--wait"));
      return;
    }

    usage();
    process.exit(1);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

void main();
