#!/usr/bin/env node
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import { validateSkillBundle } from "@skillist/skill-format";

const API_URL = process.env.SKILLIST_API_URL ?? "http://localhost:8787";
const API_KEY = process.env.SKILLIST_API_KEY;

function usage() {
  console.log(`Skillist CLI — sync agent skills with skillist.dev

Usage:
  skillist pull <org>/<skill> [-o <dir>]   Download published skill bundle
  skillist push <org>/<skill> <dir>        Upload local skill as new draft version

Environment:
  SKILLIST_API_URL   API base URL (default: http://localhost:8787)
  SKILLIST_API_KEY   Bearer token (sk_...) — required for push
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

async function pull(ref: string, outDir: string) {
  const { org, skill } = parseRef(ref);
  const res = await apiFetch(`/v1/skills/${org}/${skill}/bundle`);
  const bundle = (await res.json()) as { files: Record<string, string> };

  await mkdir(outDir, { recursive: true });
  for (const [path, content] of Object.entries(bundle.files)) {
    const filePath = join(outDir, path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
  }
  console.log(`Pulled ${org}/${skill} → ${outDir} (${Object.keys(bundle.files).length} files)`);
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

async function push(ref: string, dir: string) {
  if (!API_KEY) throw new Error("SKILLIST_API_KEY is required for push");

  const { org, skill } = parseRef(ref);
  const fileMap = await readLocalBundle(dir);
  const files = Object.fromEntries(fileMap);
  const bundle = new Map(Object.entries(files));
  const validation = validateSkillBundle(bundle, skill);
  if (!validation.valid) {
    throw new Error(`Invalid skill: ${validation.errors.map((e) => e.message).join(", ")}`);
  }

  const orgsRes = await apiFetch("/v1/orgs");
  const orgs = (await orgsRes.json()) as { id: string; slug: string }[];
  const orgRecord = orgs.find((o) => o.slug === org);
  if (!orgRecord) {
    throw new Error(`Org "${org}" not found — create it in the dashboard first`);
  }

  const versionsRes = await apiFetch(`/v1/orgs/${orgRecord.id}/skills/${skill}/versions`);
  const versions = (await versionsRes.json()) as { id: string; status: string }[];
  const latest = versions.find((v) => v.status === "draft") ?? versions[0];

  await apiFetch(`/v1/orgs/${orgRecord.id}/skills/${skill}/versions`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files,
      parentVersionId: latest?.id,
    }),
  });

  console.log(`Pushed ${relative(process.cwd(), dir)} → ${org}/${skill}`);
}

async function main() {
  const [, , cmd, ref, arg] = process.argv;

  if (!cmd || cmd === "help" || cmd === "--help") {
    usage();
    return;
  }

  try {
    if (cmd === "pull") {
      const outIdx = process.argv.indexOf("-o");
      const outDir = outIdx >= 0 ? process.argv[outIdx + 1]! : `./${ref?.split("/")[1] ?? "skill"}`;
      if (!ref) throw new Error("Missing org/skill ref");
      await pull(ref, outDir);
      return;
    }

    if (cmd === "push") {
      if (!ref || !arg) throw new Error("Usage: skillist push <org>/<skill> <dir>");
      await push(ref, arg);
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
