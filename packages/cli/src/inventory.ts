import { execFile } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const AGENT_SKILL_ROOTS = [
  ".cursor/skills",
  ".claude/skills",
  ".vscode/skills",
  "skills",
] as const;

export type InventoryScanItem = {
  repoFullName: string;
  filePath: string;
  localSlug?: string;
  registryOrgSlug?: string;
  registryRepo?: string;
};

export function parseGitRemoteUrl(url: string): string | null {
  const trimmed = url.trim();
  const sshMatch = /^git@github\.com:([^/]+\/[^/.]+?)(?:\.git)?$/i.exec(trimmed);
  if (sshMatch) return sshMatch[1]!;

  try {
    const parsed = new URL(trimmed);
    const parts = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (parts.length >= 2 && parsed.hostname?.replace(/^www\./, "") === "github.com") {
      const repo = parts[1]!.replace(/\.git$/, "");
      return `${parts[0]}/${repo}`;
    }
  } catch {
    // not a URL
  }

  return null;
}

export async function resolveRepoFullName(cwd: string): Promise<string> {
  const fromEnv = process.env.GITHUB_REPOSITORY?.trim();
  if (fromEnv) return fromEnv;

  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], { cwd });
    const parsed = parseGitRemoteUrl(stdout);
    if (parsed) return parsed;
  } catch {
    // no git remote
  }

  throw new Error(
    "Could not determine repoFullName — set GITHUB_REPOSITORY or run inside a git repo with origin",
  );
}

function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}

export async function discoverSkillItems(
  cwd: string,
  repoFullName: string,
): Promise<InventoryScanItem[]> {
  const items: InventoryScanItem[] = [];
  const seen = new Set<string>();

  for (const root of AGENT_SKILL_ROOTS) {
    const rootPath = join(cwd, root);
    try {
      await access(rootPath);
    } catch {
      continue;
    }

    const entries = await readdir(rootPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

      const skillMd = join(rootPath, entry.name, "SKILL.md");
      try {
        await access(skillMd);
      } catch {
        continue;
      }

      const filePath = toPosixPath(relative(cwd, skillMd));
      if (seen.has(filePath)) continue;
      seen.add(filePath);

      items.push({
        repoFullName,
        filePath,
        localSlug: entry.name,
      });
    }
  }

  return items;
}
