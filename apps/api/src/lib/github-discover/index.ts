import { skillSourceSuggestions, skillSources } from "@skillist/db/schema";
import { and, eq } from "drizzle-orm";
import type { Env } from "../../env";
import type { WorkerDb } from "../db";
import { fetchRepoMetadata, isCompatibleLicense } from "../github-sync/fetch";

const SEARCH_QUERIES = [
  "topic:agent-skills filename:SKILL.md",
  "topic:agentskills filename:SKILL.md",
  "path:skills filename:SKILL.md org:anthropics OR org:cloudflare OR org:microsoft OR org:adobe OR org:aws",
];

type GithubSearchItem = {
  repository: {
    full_name: string;
    stargazers_count?: number;
    owner?: { login: string; type?: string };
    license?: { spdx_id?: string | null } | null;
    html_url: string;
  };
};

function scoreCandidate(input: {
  stars: number;
  license: string | null;
  ownerType?: string;
}): number {
  let score = 0;
  if (input.stars >= 1000) score += 40;
  else if (input.stars >= 100) score += 25;
  else if (input.stars >= 10) score += 10;
  if (isCompatibleLicense(input.license)) score += 30;
  if (input.ownerType === "Organization") score += 20;
  return score;
}

async function searchGithubRepos(query: string, token?: string): Promise<GithubSearchItem[]> {
  const url = new URL("https://api.github.com/search/code");
  url.searchParams.set("q", query);
  url.searchParams.set("per_page", "30");

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "skillist-mirror-sync",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    // Code search often needs a token; soft-fail so cron does not die
    console.warn(JSON.stringify({ msg: "github_search_failed", status: res.status, query }));
    return [];
  }
  const data = (await res.json()) as { items?: GithubSearchItem[] };
  return data.items ?? [];
}

/**
 * Weekly discovery: find candidate official skill repos and insert suggestions
 * for admin approval (never auto-import).
 */
export async function discoverOfficialSources(
  env: Env,
  db: WorkerDb,
): Promise<{
  suggested: number;
  skipped: number;
}> {
  const seen = new Set<string>();
  let suggested = 0;
  let skipped = 0;

  for (const query of SEARCH_QUERIES) {
    const items = await searchGithubRepos(query, env.GITHUB_TOKEN);
    for (const item of items) {
      const fullName = item.repository.full_name;
      if (!fullName || seen.has(fullName)) continue;
      seen.add(fullName);

      const [owner, repo] = fullName.split("/");
      if (!owner || !repo) continue;

      const [existingSource] = await db
        .select({ id: skillSources.id })
        .from(skillSources)
        .where(and(eq(skillSources.githubOwner, owner), eq(skillSources.githubRepo, repo)))
        .limit(1);
      if (existingSource) {
        skipped++;
        continue;
      }

      let license =
        item.repository.license?.spdx_id && item.repository.license.spdx_id !== "NOASSERTION"
          ? item.repository.license.spdx_id
          : null;
      let stars = item.repository.stargazers_count ?? 0;

      try {
        const meta = await fetchRepoMetadata(owner, repo, env.GITHUB_TOKEN);
        license = meta.license;
        stars = meta.stars;
      } catch {
        // keep search-result fields
      }

      const matchScore = scoreCandidate({
        stars,
        license,
        ownerType: item.repository.owner?.type,
      });
      if (matchScore < 20) {
        skipped++;
        continue;
      }

      await db
        .insert(skillSourceSuggestions)
        .values({
          githubOwner: owner,
          githubRepo: repo,
          discoveredVia: query,
          stars,
          license,
          matchScore,
          status: "pending",
        })
        .onConflictDoUpdate({
          target: [skillSourceSuggestions.githubOwner, skillSourceSuggestions.githubRepo],
          set: {
            stars,
            license,
            matchScore,
            discoveredVia: query,
            updatedAt: new Date(),
          },
        });
      suggested++;
    }
  }

  return { suggested, skipped };
}
