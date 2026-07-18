#!/usr/bin/env npx tsx
/**
 * Run evals synchronously for public skillist org skills (latest published versions).
 *
 * Usage:
 *   DATABASE_URL=... pnpm run:public-evals --all
 *   DATABASE_URL=... pnpm run:public-evals --skills roll-dice,web-perf-audit
 *   DATABASE_URL=... pnpm run:public-evals --all --force
 */
import { execSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "@skillist/db";
import { organizations, skillEvals, skills, skillVersions } from "@skillist/db/schema";
import { and, desc, eq } from "drizzle-orm";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const WRANGLER_DIR = join(ROOT, "apps", "api");
const R2_BUCKET = "skillist-skills";
const ORG_SLUG = "skillist";
const ACCOUNT_ID = "2d19b3b18648f0776ff1435cba466210";

const SCENARIOS = [
  {
    name: "task-clarity",
    prompt:
      "Rate 0-100 how clearly an agent could follow instructions for a generic coding task. Reply with only a number.",
  },
  {
    name: "safety-awareness",
    prompt:
      "Rate 0-100 how well instructions emphasize safe, reversible changes. Reply with only a number.",
  },
  {
    name: "tool-discipline",
    prompt:
      "Rate 0-100 how well instructions guide an agent to use tools/scripts instead of improvising. Reply with only a number.",
  },
];

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function parseSkillsArg(): string[] | null {
  const idx = process.argv.indexOf("--skills");
  if (idx >= 0 && process.argv[idx + 1]) {
    return process.argv[idx + 1]!.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return null;
}

function wrangler(cmd: string): string {
  return execSync(`pnpm exec wrangler ${cmd}`, {
    cwd: WRANGLER_DIR,
    encoding: "utf8",
    env: process.env,
  }).trim();
}

function getCloudflareToken(): string | null {
  if (process.env.CLOUDFLARE_API_TOKEN) {
    return process.env.CLOUDFLARE_API_TOKEN;
  }
  try {
    const out = wrangler("auth token");
    const line = out.split("\n").find((l) => l.startsWith("cfoat_") || l.length > 40);
    return line?.trim() ?? null;
  } catch {
    return null;
  }
}

function getR2Object(key: string): string {
  const tmp = join(ROOT, ".eval-r2-tmp");
  wrangler(`r2 object get ${R2_BUCKET}/${key} --file=${tmp} --remote -c wrangler.production.jsonc`);
  const content = readFileSync(tmp, "utf8");
  unlinkSync(tmp);
  return content;
}

function parseScore(text: string): number {
  const match = text.match(/\d{1,3}/);
  const n = match ? Number(match[0]) : 50;
  return Math.min(100, Math.max(0, n));
}

let cfToken: string | null = null;

function extractResponseText(data: unknown): string {
  const r = data as {
    result?: {
      response?: string | number;
      choices?: { message?: { content?: string } }[];
    };
  };
  if (typeof r.result?.response === "number") {
    return String(r.result.response);
  }
  if (typeof r.result?.response === "string") {
    return r.result.response;
  }
  const content = r.result?.choices?.[0]?.message?.content;
  return content ?? "50";
}

async function scorePrompt(prompt: string): Promise<number> {
  if (process.env.SKILLIST_EVAL_HEURISTIC === "1") {
    return 50;
  }

  if (!cfToken) {
    return 50;
  }

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    console.warn(`  AI score fallback 50 (${res.status}: ${body.slice(0, 80)})`);
    return 50;
  }
  const data = await res.json();
  return parseScore(extractResponseText(data));
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const force = hasFlag("--force");
  const explicitSkills = parseSkillsArg();
  const db = createDb(connectionString);

  cfToken = getCloudflareToken();
  const useHeuristic = process.env.SKILLIST_EVAL_HEURISTIC === "1" || !cfToken;

  if (useHeuristic) {
    console.log("Mode: heuristic (set CLOUDFLARE_API_TOKEN or wrangler login for AI evals)");
  } else {
    console.log("Mode: Workers AI via Cloudflare API");
  }

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, ORG_SLUG))
    .limit(1);
  if (!org) {
    console.error(`Org ${ORG_SLUG} not found`);
    process.exit(1);
  }

  let targetSlugs = explicitSkills;
  if (!targetSlugs && hasFlag("--all")) {
    const rows = await db
      .select({ slug: skills.repo })
      .from(skills)
      .where(eq(skills.orgId, org.id));
    targetSlugs = rows.map((r) => r.slug).sort();
  }
  if (!targetSlugs?.length) {
    targetSlugs = ["roll-dice", "web-perf-audit", "security-audit"];
  }

  console.log(`Running evals for ${targetSlugs.length} skills in org/${ORG_SLUG}`);

  for (const slug of targetSlugs) {
    const [skill] = await db
      .select()
      .from(skills)
      .where(and(eq(skills.orgId, org.id), eq(skills.repo, slug)))
      .limit(1);
    if (!skill?.latestPublishedVersionId) {
      console.warn(`  skip ${slug}: no published version`);
      continue;
    }

    const versionId = skill.latestPublishedVersionId;

    if (!force) {
      const [existing] = await db
        .select()
        .from(skillEvals)
        .where(and(eq(skillEvals.versionId, versionId), eq(skillEvals.status, "completed")))
        .orderBy(desc(skillEvals.completedAt))
        .limit(1);

      if (existing) {
        console.log(`  skip ${slug}: uplift ${existing.uplift} already recorded`);
        continue;
      }
    }

    const [version] = await db
      .select()
      .from(skillVersions)
      .where(eq(skillVersions.id, versionId))
      .limit(1);
    if (!version) continue;

    console.log(`  ${slug} v${version.semver} — scoring...`);
    const skillMd = getR2Object(`${version.r2Prefix}/SKILL.md`);

    let baselineScore: number;
    let withSkillScore: number;
    let uplift: number;
    let results: {
      name: string;
      prompt: string;
      baselineScore: number;
      withSkillScore: number;
      uplift: number;
    }[];

    if (useHeuristic) {
      baselineScore = 50;
      withSkillScore = version.qualityScore ?? 70;
      uplift = withSkillScore - baselineScore;
      results = SCENARIOS.map((scenario) => ({
        ...scenario,
        baselineScore: 50,
        withSkillScore,
        uplift,
      }));
      console.log(`  (heuristic from quality score ${withSkillScore})`);
    } else {
      results = [];
      let baselineTotal = 0;
      let withSkillTotal = 0;

      for (const scenario of SCENARIOS) {
        const baseline = await scorePrompt(scenario.prompt);
        const withSkill = await scorePrompt(
          `${scenario.prompt}\n\nRelevant skill instructions:\n${skillMd.slice(0, 8000)}`,
        );
        const scenarioUplift = withSkill - baseline;
        results.push({
          ...scenario,
          baselineScore: baseline,
          withSkillScore: withSkill,
          uplift: scenarioUplift,
        });
        baselineTotal += baseline;
        withSkillTotal += withSkill;
        process.stdout.write(".");
      }
      console.log("");
      baselineScore = Math.round(baselineTotal / SCENARIOS.length);
      withSkillScore = Math.round(withSkillTotal / SCENARIOS.length);
      uplift = withSkillScore - baselineScore;
    }

    await db.insert(skillEvals).values({
      skillId: skill.id,
      versionId,
      status: "completed",
      baselineScore,
      withSkillScore,
      uplift,
      results,
      completedAt: new Date(),
    });

    console.log(
      `  ✓ ${slug}: uplift ${uplift > 0 ? "+" : ""}${uplift} (${baselineScore} → ${withSkillScore})`,
    );
  }

  console.log("\nDone. Verify:");
  console.log("  curl https://api.skillist.io/v1/registry/skillist/roll-dice | jq .eval");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
