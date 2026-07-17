import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type DiscoveredSkill, scanProjectSkills } from "./scanner.js";

const execFileAsync = promisify(execFile);

export type InventoryScanItem = {
  repoFullName: string;
  filePath: string;
  localSlug?: string;
  registryOrgSlug?: string;
  registryRepo?: string;
  sourceType?: string;
  scope?: string;
  marketplace?: string;
  pluginName?: string;
  isSymlink?: boolean;
  conformanceStatus?: string;
  conformanceIssues?: { level: string; field?: string; message: string }[];
  contentHash?: string;
  skillMd?: string;
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

function toScanItem(skill: DiscoveredSkill, repoFullName: string): InventoryScanItem {
  return {
    repoFullName,
    filePath: skill.filePath,
    localSlug: skill.localSlug,
    sourceType: skill.sourceType,
    scope: skill.scope,
    marketplace: skill.marketplace,
    pluginName: skill.pluginName,
    isSymlink: skill.isSymlink,
    conformanceStatus: skill.conformanceStatus,
    conformanceIssues: skill.conformanceIssues,
    contentHash: skill.contentHash,
    skillMd: skill.skillMd,
  };
}

export async function discoverSkillItems(
  cwd: string,
  repoFullName: string,
): Promise<InventoryScanItem[]> {
  const skills = await scanProjectSkills(cwd);
  return skills.map((s) => toScanItem(s, repoFullName));
}

/** Import skills from GitHub org via authenticated `gh` CLI (Tessl-style estate scan). */
export async function importGithubOrgInventory(options: {
  githubOrg: string;
  limit?: number;
  repos?: string[];
}): Promise<InventoryScanItem[]> {
  const limit = options.limit ?? 100;
  let repoNames: string[];

  if (options.repos?.length) {
    repoNames = options.repos.map((r) => (r.includes("/") ? r : `${options.githubOrg}/${r}`));
  } else {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "repo",
        "list",
        options.githubOrg,
        "--limit",
        String(limit),
        "--json",
        "nameWithOwner",
        "--jq",
        ".[].nameWithOwner",
      ],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    repoNames = stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const items: InventoryScanItem[] = [];
  for (const repo of repoNames) {
    try {
      const { stdout: tree } = await execFileAsync(
        "gh",
        ["api", `repos/${repo}/git/trees/HEAD?recursive=1`, "--jq", ".tree[].path"],
        { maxBuffer: 20 * 1024 * 1024 },
      );
      const paths = tree
        .split("\n")
        .map((s) => s.trim())
        .filter((p) => p.endsWith("/SKILL.md") || p === "SKILL.md" || p.endsWith("SKILL.md"));

      for (const filePath of paths) {
        if (filePath.includes("node_modules/") || filePath.includes("/.git/")) continue;
        try {
          const { stdout: content } = await execFileAsync(
            "gh",
            ["api", `repos/${repo}/contents/${filePath}`, "--jq", ".content"],
            { maxBuffer: 5 * 1024 * 1024 },
          );
          const b64 = content.trim().replace(/\n/g, "");
          const skillMd = Buffer.from(b64, "base64").toString("utf8");
          const parts = filePath.split("/");
          const localSlug =
            parts.length >= 2 ? parts[parts.length - 2]! : filePath.replace(/\/?SKILL\.md$/, "");
          const { createHash } = await import("node:crypto");
          const contentHash = createHash("sha256").update(skillMd).digest("hex").slice(0, 16);
          const { inferMarketplace, inferScope, inferType } = await import("./source.js");
          const absHint = `/${repo}/${filePath}`;
          items.push({
            repoFullName: repo,
            filePath,
            localSlug,
            sourceType: inferType(absHint),
            scope: inferScope(absHint),
            ...inferMarketplace(absHint),
            contentHash,
            skillMd,
            conformanceStatus: skillMd.includes("---") ? "valid" : "invalid",
          });
        } catch {
          // skip unreadable file
        }
      }
    } catch {
      // skip inaccessible repo
    }
  }

  return items;
}
