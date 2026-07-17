#!/usr/bin/env node
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { createInterface } from "node:readline";
import { type SemverBump, validateSkillBundle } from "@skillist/skill-format";
import { discoverSkillItems, importGithubOrgInventory, resolveRepoFullName } from "./inventory.js";
import { reviewLocalSkill } from "./review.js";

const API_URL = process.env.SKILLIST_API_URL ?? "https://api.skillist.dev";
const DELIVERY_URL = process.env.SKILLIST_DELIVERY_URL ?? "https://skillist.dev";
const API_KEY = process.env.SKILLIST_API_KEY;
const LOCKFILE = ".skillist.lock";

type LockEntry = {
  org: string;
  repo: string;
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
                                              [--category <cat>] [--tag <tag>]
                                              [--agent <name>] [--sort ...]
  skillist install <org>/<repo> [-o dir]   Download and record in lockfile
                                              [--org <policy-org>] [--accept-warnings]
  skillist pull <org>/<repo> [-o dir]      Download published skill bundle
  skillist push <org>/<repo> <dir>         Upload local skill as new draft
                                              [--bump major|minor|patch]
  skillist publish <org>/<repo> <dir>        Push + publish to registry
                                              [--bump major|minor|patch]
  skillist review <dir>                    Review local skill quality + security
                                              [--json] [--threshold N] [--fail-on sev]
                                              [--slug <name>] [--org <slug>]
  skillist run <org>/<repo> --script <path>    Run script in hosted sandbox
                                              [--url <url>] [--stream] [-- ...args]
  skillist eval <org>/<repo>                  Queue skill eval on latest draft
                                              [--wait]
  skillist rollback <org>/<repo> <semver>     Roll back to a previous published version
  skillist update [org/repo]               Update installed skills from lockfile
  skillist list                            List skills in lockfile
  skillist required-skills check [--org]   Check lockfile against org required skills
  skillist inventory scan [--org <slug>]   Discover local skills and POST inventory scan
                                              [--dry-run] [--json]
  skillist inventory import --github-org   Scan GitHub org via gh CLI and POST inventory
     <org> [--org <slug>] [--limit N] [--repo a --repo b] [--dry-run] [--json]
  skillist inventory list [--org <slug>]   List org skill inventory
  skillist mcp proxy <org>/<name>          Stdio proxy to org MCP gateway server

Environment:
  SKILLIST_API_URL        API base URL (default: https://api.skillist.dev)
  SKILLIST_DELIVERY_URL   Public delivery URL (default: https://skillist.dev)
  SKILLIST_API_KEY        Bearer token (sk_...) — required for push/publish
`);
}

function parseRef(ref: string): { org: string; repo: string } {
  const [org, repo] = ref.split("/");
  if (!org || !repo) {
    throw new Error(`Invalid ref "${ref}" — use org/repo`);
  }
  return { org, repo };
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

async function deliveryFetch(path: string, init?: RequestInit) {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
  };
  if (API_KEY && !headers.Authorization) {
    headers.Authorization = `Bearer ${API_KEY}`;
  }
  const res = await fetch(`${DELIVERY_URL}${path}`, { ...init, headers });
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
    const parsed = JSON.parse(raw) as {
      version: 1;
      skills: Array<{
        org: string;
        repo?: string;
        skill?: string;
        version: string;
        installedAt: string;
        path: string;
      }>;
    };
    // Migrate legacy lock entries that used `skill` instead of `repo`
    return {
      version: 1,
      skills: parsed.skills.map((s) => ({
        org: s.org,
        repo: s.repo ?? s.skill ?? "",
        version: s.version,
        installedAt: s.installedAt,
        path: s.path,
      })),
    };
  } catch {
    return { version: 1, skills: [] };
  }
}

async function writeLockfile(lock: Lockfile) {
  await writeFile(LOCKFILE, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

async function recordTelemetry(org: string, repo: string, eventType: "install" | "activation") {
  try {
    await apiFetch("/v1/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgSlug: org, skillRepo: repo, eventType }),
    });
  } catch {
    // telemetry is best-effort
  }
}

async function search(
  query: string,
  options: { category?: string; tag?: string; sort?: string; agent?: string } = {},
) {
  const params = new URLSearchParams({ limit: "20" });
  if (query) params.set("q", query);
  if (options.category) params.set("category", options.category);
  if (options.tag) params.set("tag", options.tag);
  if (options.sort) params.set("sort", options.sort);
  if (options.agent) params.set("agent", options.agent);
  const res = await apiFetch(`/v1/registry?${params}`);
  const data = (await res.json()) as {
    items: {
      orgSlug: string;
      skillRepo: string;
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
      `${item.orgSlug}/${item.skillRepo}  ${item.name}  v${item.latestVersion ?? "?"}  ${scores}${tags}`,
    );
    console.log(`  ${item.description.slice(0, 100)}`);
    console.log(`  ${item.installCommand ?? `skillist install ${item.orgSlug}/${item.skillRepo}`}`);
    console.log();
  }
  console.log(`${data.total} total matches`);
}

async function confirmWarn(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`${message} Continue? [y/N] `, resolve);
  });
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function enforceInstallPolicy(
  ref: string,
  options: { acceptWarnings?: boolean; policyOrg?: string } = {},
): Promise<void> {
  if (!API_KEY) return;
  const { org, repo } = parseRef(ref);
  try {
    const policyOrg = await resolveOrg(options.policyOrg ?? parseOrgFlag());
    const res = await apiFetch(`/v1/orgs/${policyOrg.id}/install-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgSlug: org, skillRepo: repo, source: "registry" }),
    });
    const check = (await res.json()) as {
      allowed: boolean;
      decision: "allow" | "warn" | "block";
      reasons: string[];
      headline: string;
      severity: string;
    };

    if (check.decision === "allow") return;

    const detail = check.reasons.join("; ") || check.headline;
    if (check.decision === "block") {
      throw new Error(
        `Blocked by install policy (${check.headline} / ${check.severity}): ${detail}`,
      );
    }

    console.error(`Install policy warning (${check.headline}): ${detail}`);
    if (options.acceptWarnings) return;
    const ok = await confirmWarn("Proceed with install despite warnings?");
    if (!ok) throw new Error("Install cancelled due to policy warnings");
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Blocked by install policy")) throw err;
    if (err instanceof Error && err.message.startsWith("Install cancelled")) throw err;
    // No org / policy configured — allow install
  }
}

async function pull(
  ref: string,
  outDir: string,
  recordLock = false,
  options: { acceptWarnings?: boolean; policyOrg?: string } = {},
) {
  const { org, repo } = parseRef(ref);
  if (recordLock) {
    await enforceInstallPolicy(ref, options);
  }
  const res = await deliveryFetch(`/${org}/${repo}/bundle`);
  const bundle = (await res.json()) as { files: Record<string, string>; version: string };

  await mkdir(outDir, { recursive: true });
  for (const [path, content] of Object.entries(bundle.files)) {
    const filePath = join(outDir, path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
  }

  if (recordLock) {
    const lock = await readLockfile();
    const existing = lock.skills.findIndex((s) => s.org === org && s.repo === repo);
    const entry: LockEntry = {
      org,
      repo,
      version: bundle.version,
      installedAt: new Date().toISOString(),
      path: outDir,
    };
    if (existing >= 0) lock.skills[existing] = entry;
    else lock.skills.push(entry);
    await writeLockfile(lock);
    await recordTelemetry(org, repo, "install");
  }

  console.log(
    `Pulled ${org}/${repo} → ${outDir} (${Object.keys(bundle.files).length} files, v${bundle.version})`,
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
  const org = await resolveOrg(orgSlug);
  return org.id;
}

async function resolveOrg(explicitSlug?: string): Promise<{ id: string; slug: string }> {
  const orgsRes = await apiFetch("/v1/orgs");
  const orgs = (await orgsRes.json()) as { id: string; slug: string }[];
  if (orgs.length === 0) {
    throw new Error("No organizations found — create one in the dashboard first");
  }
  if (explicitSlug) {
    const org = orgs.find((o) => o.slug === explicitSlug);
    if (!org) throw new Error(`Org "${explicitSlug}" not found`);
    return org;
  }
  if (orgs.length === 1) return orgs[0]!;
  throw new Error(`Multiple orgs — pass --org (${orgs.map((o) => o.slug).join(", ")})`);
}

type InventoryRecord = {
  id: string;
  repoFullName: string;
  filePath: string;
  localSlug: string | null;
  managed: boolean;
  registryOrgSlug: string | null;
  registryRepo: string | null;
  scannedAt: string;
};

function parseOrgFlag(): string | undefined {
  const idx = process.argv.indexOf("--org");
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function scanInventory(options: { dryRun?: boolean; json?: boolean } = {}) {
  const repoFullName = await resolveRepoFullName(process.cwd());
  const items = await discoverSkillItems(process.cwd(), repoFullName);

  if (items.length === 0) {
    console.log(
      "No skills found under .cursor/skills, .claude/skills, .agents/skills, .gemini/skills, .codex/skills, .vscode/skills, or skills/",
    );
    return;
  }

  if (options.dryRun) {
    console.log(JSON.stringify({ items: items.map(({ skillMd: _, ...rest }) => rest) }, null, 2));
    return;
  }

  if (!API_KEY) throw new Error("SKILLIST_API_KEY is required for inventory scan");

  const org = await resolveOrg(parseOrgFlag());

  const res = await apiFetch(`/v1/orgs/${org.id}/inventory/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  const result = (await res.json()) as {
    upserted: number;
    diff?: { created: number; updated: number; removed: number };
    duplicates?: { slugs: string[]; contentHashes: string[] };
  };

  if (options.json) {
    console.log(
      JSON.stringify({
        org: org.slug,
        repoFullName,
        upserted: result.upserted,
        diff: result.diff,
        duplicates: result.duplicates,
        items: items.map(({ skillMd: _, ...rest }) => rest),
      }),
    );
    return;
  }

  console.log(
    `Scanned ${items.length} skill(s) in ${repoFullName} → ${org.slug} (${result.upserted} upserted)`,
  );
  if (result.diff) {
    console.log(`  diff: +${result.diff.created} ~${result.diff.updated} -${result.diff.removed}`);
  }
  for (const item of items) {
    const meta = [item.sourceType, item.conformanceStatus].filter(Boolean).join(" · ");
    console.log(
      `  ${item.filePath}${item.localSlug ? ` (${item.localSlug})` : ""}${meta ? ` [${meta}]` : ""}`,
    );
  }
}

async function importInventory(options: {
  githubOrg: string;
  limit?: number;
  repos?: string[];
  dryRun?: boolean;
  json?: boolean;
}) {
  if (!options.dryRun && !API_KEY) {
    throw new Error("SKILLIST_API_KEY is required for inventory import");
  }

  const items = await importGithubOrgInventory({
    githubOrg: options.githubOrg,
    limit: options.limit,
    repos: options.repos,
  });

  if (options.dryRun) {
    console.log(JSON.stringify({ items: items.map(({ skillMd: _, ...rest }) => rest) }, null, 2));
    return;
  }

  const org = await resolveOrg(parseOrgFlag());
  const res = await apiFetch(`/v1/orgs/${org.id}/inventory/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  const result = (await res.json()) as {
    upserted: number;
    diff?: { created: number; updated: number; removed: number };
    duplicates?: { slugs: string[]; contentHashes: string[] };
  };

  if (options.json) {
    console.log(JSON.stringify({ org: org.slug, ...result, count: items.length }));
    return;
  }

  console.log(
    `Imported ${items.length} skill(s) from github:${options.githubOrg} → ${org.slug} (${result.upserted} upserted)`,
  );
  if (result.diff) {
    console.log(`  diff: +${result.diff.created} ~${result.diff.updated} -${result.diff.removed}`);
  }
  if (result.duplicates?.slugs?.length) {
    console.log(`  duplicate slugs: ${result.duplicates.slugs.join(", ")}`);
  }
}

async function runReview(dir: string) {
  const thresholdIdx = process.argv.indexOf("--threshold");
  const failOnIdx = process.argv.indexOf("--fail-on");
  const slugIdx = process.argv.indexOf("--slug");
  const threshold = thresholdIdx >= 0 ? Number(process.argv[thresholdIdx + 1]) : undefined;
  const failOn =
    failOnIdx >= 0
      ? (process.argv[failOnIdx + 1] as "low" | "medium" | "high" | "critical")
      : undefined;
  const expectedSlug = slugIdx >= 0 ? process.argv[slugIdx + 1] : undefined;

  let rubric = null;
  const orgFlag = parseOrgFlag();
  if (API_KEY && orgFlag) {
    try {
      const org = await resolveOrg(orgFlag);
      const res = await apiFetch(`/v1/orgs/${org.id}/review-rubric`);
      const data = (await res.json()) as { reviewRubric: Record<string, unknown> };
      rubric = data.reviewRubric;
    } catch {
      // use default rubric
    }
  }

  const result = await reviewLocalSkill(dir, {
    expectedSlug,
    threshold,
    failOn,
    rubric,
  });

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Quality score: ${result.score}`);
    for (const check of result.checks) {
      console.log(`  ${check.passed ? "✓" : "✗"} ${check.label}: ${check.message}`);
    }
    console.log(`Security: ${result.security.status} (score ${result.security.score})`);
    for (const issue of result.security.issues) {
      console.log(`  [${issue.severity}] ${issue.path}: ${issue.message}`);
    }
  }

  if (!result.ok) process.exit(result.exitCode);
}

async function checkRequiredSkills() {
  if (!API_KEY) throw new Error("SKILLIST_API_KEY is required");
  const org = await resolveOrg(parseOrgFlag());
  const lock = await readLockfile();
  const installed = lock.skills.map((s) => `${s.org}/${s.repo}`).join(",");
  const res = await apiFetch(
    `/v1/orgs/${org.id}/required-skills/check?installed=${encodeURIComponent(installed)}`,
  );
  const data = (await res.json()) as {
    required: string[];
    missing: string[];
    compliant: boolean;
  };
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(data, null, 2));
  } else if (data.compliant) {
    console.log(`All ${data.required.length} required skill(s) are installed`);
  } else {
    console.error(`Missing required skills: ${data.missing.join(", ")}`);
    process.exit(1);
  }
}

async function mcpProxy(ref: string) {
  if (!API_KEY) throw new Error("SKILLIST_API_KEY is required for mcp proxy");
  const [orgSlug, name] = ref.split("/");
  if (!orgSlug || !name) throw new Error("Usage: skillist mcp proxy <org>/<name>");
  const org = await resolveOrg(orgSlug);
  const res = await apiFetch(`/v1/orgs/${org.id}/mcp-servers/${name}/proxy`);
  const cfg = (await res.json()) as {
    upstreamUrl: string;
    transport: string;
    accessToken: string;
  };

  // Minimal JSON-RPC stdio ↔ HTTP bridge
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const upstream = await fetch(cfg.upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.accessToken}`,
        Accept: "application/json, text/event-stream",
      },
      body: line,
    });
    const text = await upstream.text();
    if (cfg.transport === "sse") {
      for (const chunk of text.split("\n")) {
        if (chunk.startsWith("data: ")) {
          process.stdout.write(`${chunk.slice(6)}\n`);
        }
      }
    } else {
      process.stdout.write(`${text}\n`);
    }
  }
}

async function listInventory(json = false) {
  if (!API_KEY) throw new Error("SKILLIST_API_KEY is required for inventory list");

  const org = await resolveOrg(parseOrgFlag());
  const res = await apiFetch(`/v1/orgs/${org.id}/inventory`);
  const data = (await res.json()) as { items: InventoryRecord[] };

  if (json) {
    console.log(JSON.stringify({ org: org.slug, items: data.items }, null, 2));
    return;
  }

  if (data.items.length === 0) {
    console.log(`No inventory items for ${org.slug}`);
    return;
  }

  for (const item of data.items) {
    const link =
      item.managed && item.registryOrgSlug && item.registryRepo
        ? `${item.registryOrgSlug}/${item.registryRepo}`
        : "local";
    console.log(
      `${item.repoFullName}  ${item.filePath}  ${link}  (${item.scannedAt.slice(0, 10)})`,
    );
  }
  console.log(`${data.items.length} item(s) for ${org.slug}`);
}

async function pushDraft(
  org: string,
  repo: string,
  dir: string,
  bump: SemverBump = "patch",
): Promise<{ versionId: string; orgId: string; semver: string }> {
  const fileMap = await readLocalBundle(dir);
  const files = Object.fromEntries(fileMap);
  const bundle = new Map(Object.entries(files));
  const validation = validateSkillBundle(bundle, repo);
  if (!validation.valid) {
    throw new Error(`Invalid skill: ${validation.errors.map((e) => e.message).join(", ")}`);
  }

  const orgId = await resolveOrgId(org);

  const versionsRes = await apiFetch(`/v1/orgs/${orgId}/skills/${repo}/versions`);
  const versions = (await versionsRes.json()) as {
    id: string;
    status: string;
    semver: string;
  }[];
  const latest = versions.find((v) => v.status === "draft") ?? versions[0];

  const uploadRes = await apiFetch(`/v1/orgs/${orgId}/skills/${repo}/versions`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files,
      parentVersionId: latest?.id,
      bump,
    }),
  });
  const uploaded = (await uploadRes.json()) as { id: string; semver: string };

  return { versionId: uploaded.id, orgId, semver: uploaded.semver };
}

function parseBumpFlag(): SemverBump {
  const idx = process.argv.indexOf("--bump");
  const value = idx >= 0 ? process.argv[idx + 1] : "patch";
  if (value === "major" || value === "minor" || value === "patch") return value;
  throw new Error(`Invalid --bump value "${value}" — use major, minor, or patch`);
}

async function push(ref: string, dir: string) {
  if (!API_KEY) throw new Error("SKILLIST_API_KEY is required for push");
  const { org, repo } = parseRef(ref);
  const { semver } = await pushDraft(org, repo, dir, parseBumpFlag());
  console.log(`Pushed ${relative(process.cwd(), dir)} → ${org}/${repo} v${semver}`);
}

async function publish(ref: string, dir: string) {
  if (!API_KEY) throw new Error("SKILLIST_API_KEY is required for publish");
  const { org, repo } = parseRef(ref);
  const { versionId, orgId, semver } = await pushDraft(org, repo, dir, parseBumpFlag());

  const pubRes = await apiFetch(`/v1/orgs/${orgId}/skills/${repo}/versions/${versionId}/publish`, {
    method: "POST",
  });
  const result = (await pubRes.json()) as {
    version: string;
    qualityScore: number;
    impactScore: number;
    securityStatus: string;
  };

  console.log(
    `Published ${org}/${repo} v${result.version} (draft v${semver}) — Q${result.qualityScore} I${result.impactScore} security:${result.securityStatus}`,
  );
}

async function update(ref?: string) {
  const lock = await readLockfile();
  const targets = ref ? lock.skills.filter((s) => `${s.org}/${s.repo}` === ref) : lock.skills;

  if (targets.length === 0) {
    console.log(ref ? `No lockfile entry for ${ref}` : "Lockfile is empty — run install first");
    return;
  }

  const acceptWarnings = process.argv.includes("--accept-warnings");
  for (const entry of targets) {
    await pull(`${entry.org}/${entry.repo}`, entry.path, true, {
      acceptWarnings,
      policyOrg: parseOrgFlag(),
    });
  }
}

async function listInstalled() {
  const lock = await readLockfile();
  if (lock.skills.length === 0) {
    console.log("No installed skills in .skillist.lock");
    return;
  }
  for (const s of lock.skills) {
    console.log(`${s.org}/${s.repo}  v${s.version}  ${s.path}  (${s.installedAt.slice(0, 10)})`);
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
  const { org, repo } = parseRef(ref);
  const res = await deliveryFetch(`/${org}/${repo}/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    },
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
  const { org, repo } = parseRef(ref);
  const orgId = await resolveOrgId(org);

  const versionsRes = await apiFetch(`/v1/orgs/${orgId}/skills/${repo}/versions`);
  const versions = (await versionsRes.json()) as { id: string; status: string }[];
  const draft = versions.find((v) => v.status === "draft") ?? versions[0];
  if (!draft) throw new Error(`No versions found for ${org}/${repo}`);

  const evalRes = await apiFetch(`/v1/orgs/${orgId}/skills/${repo}/versions/${draft.id}/eval`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const { eval: queued } = (await evalRes.json()) as {
    eval: { id: string; status: string };
  };
  console.log(`Eval queued: ${queued.id}`);

  if (!wait) return;

  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((r) => setTimeout(r, 3000));
    const detailRes = await apiFetch(`/v1/orgs/${orgId}/skills/${repo}/evals/${queued.id}`);
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

async function rollbackSkill(orgRepo: string, semver: string) {
  const { org, repo } = parseRef(orgRepo);
  const orgId = await resolveOrgId(org);
  const versionsRes = await apiFetch(`/v1/orgs/${orgId}/skills/${repo}/versions`);
  const versions = (await versionsRes.json()) as {
    id: string;
    semver: string;
    status: string;
  }[];
  const target = versions.find((v) => v.semver === semver);
  if (!target) throw new Error(`Version ${semver} not found`);
  const res = await apiFetch(`/v1/orgs/${orgId}/skills/${repo}/versions/${target.id}/rollback`, {
    method: "POST",
  });
  const result = (await res.json()) as { version: string; etag: string };
  console.log(`Rolled back ${org}/${repo} to v${result.version}`);
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
      const sortIdx = process.argv.indexOf("--sort");
      const agentIdx = process.argv.indexOf("--agent");
      await search(ref ?? "", {
        category: categoryIdx >= 0 ? process.argv[categoryIdx + 1] : undefined,
        tag: tagIdx >= 0 ? process.argv[tagIdx + 1] : undefined,
        sort: sortIdx >= 0 ? process.argv[sortIdx + 1] : undefined,
        agent: agentIdx >= 0 ? process.argv[agentIdx + 1] : undefined,
      });
      return;
    }

    if (cmd === "install") {
      const outIdx = process.argv.indexOf("-o");
      const outDir = outIdx >= 0 ? process.argv[outIdx + 1]! : `./${ref?.split("/")[1] ?? "skill"}`;
      if (!ref) throw new Error("Missing org/repo ref");
      await pull(ref, outDir, true, {
        acceptWarnings: process.argv.includes("--accept-warnings"),
        policyOrg: parseOrgFlag(),
      });
      return;
    }

    if (cmd === "review") {
      if (!ref) throw new Error("Usage: skillist review <dir> [--threshold N] [--fail-on sev]");
      await runReview(ref);
      return;
    }

    if (cmd === "required-skills") {
      if (ref !== "check") throw new Error("Usage: skillist required-skills check [--org <slug>]");
      await checkRequiredSkills();
      return;
    }

    if (cmd === "mcp") {
      if (ref !== "proxy" || !arg) throw new Error("Usage: skillist mcp proxy <org>/<name>");
      await mcpProxy(arg);
      return;
    }

    if (cmd === "pull") {
      const outIdx = process.argv.indexOf("-o");
      const outDir = outIdx >= 0 ? process.argv[outIdx + 1]! : `./${ref?.split("/")[1] ?? "skill"}`;
      if (!ref) throw new Error("Missing org/repo ref");
      await pull(ref, outDir);
      return;
    }

    if (cmd === "push") {
      if (!ref || !arg) throw new Error("Usage: skillist push <org>/<repo> <dir>");
      await push(ref, arg);
      return;
    }

    if (cmd === "publish") {
      if (!ref || !arg) throw new Error("Usage: skillist publish <org>/<repo> <dir>");
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
      if (!ref)
        throw new Error(
          "Usage: skillist run <org>/<repo> --script <path> [--url <url>] [-- ...args]",
        );
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
      if (!ref) throw new Error("Usage: skillist eval <org>/<repo> [--wait]");
      await runEval(ref, process.argv.includes("--wait"));
      return;
    }

    if (cmd === "rollback") {
      if (!ref || !arg) {
        throw new Error("Usage: skillist rollback <org>/<repo> <semver>");
      }
      await rollbackSkill(ref, arg);
      return;
    }

    if (cmd === "inventory") {
      if (ref === "scan") {
        await scanInventory({
          dryRun: process.argv.includes("--dry-run"),
          json: process.argv.includes("--json"),
        });
        return;
      }
      if (ref === "import") {
        const ghIdx = process.argv.indexOf("--github-org");
        const githubOrg = ghIdx >= 0 ? process.argv[ghIdx + 1] : undefined;
        if (!githubOrg) {
          throw new Error("Usage: skillist inventory import --github-org <org> [--org <slug>]");
        }
        const limitIdx = process.argv.indexOf("--limit");
        const repos: string[] = [];
        for (let i = 0; i < process.argv.length; i++) {
          if (process.argv[i] === "--repo" && process.argv[i + 1]) {
            repos.push(process.argv[i + 1]!);
          }
        }
        await importInventory({
          githubOrg,
          limit: limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : undefined,
          repos: repos.length ? repos : undefined,
          dryRun: process.argv.includes("--dry-run"),
          json: process.argv.includes("--json"),
        });
        return;
      }
      if (ref === "list") {
        await listInventory(process.argv.includes("--json"));
        return;
      }
      throw new Error("Usage: skillist inventory scan|import|list [--org <slug>]");
    }

    usage();
    process.exit(1);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

void main();
