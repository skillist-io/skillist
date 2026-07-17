import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type ReviewRubricConfig,
  reviewSkillBundle,
  type SecurityIssue,
  scanSkillSecurity,
} from "@skillist/skill-format";

const SEVERITY_RANK = { low: 1, medium: 2, high: 3, critical: 4 } as const;

export async function readLocalBundle(dir: string): Promise<Map<string, string>> {
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

export type ReviewCliResult = {
  score: number;
  checks: { id: string; label: string; passed: boolean; message: string; weight: number }[];
  security: {
    status: "pass" | "advisory" | "fail";
    score: number;
    issues: SecurityIssue[];
  };
  ok: boolean;
  exitCode: number;
};

export async function reviewLocalSkill(
  dir: string,
  options: {
    expectedSlug?: string;
    threshold?: number;
    failOn?: "low" | "medium" | "high" | "critical";
    rubric?: ReviewRubricConfig | null;
  } = {},
): Promise<ReviewCliResult> {
  const files = await readLocalBundle(dir);
  const review = reviewSkillBundle(files, options.expectedSlug, options.rubric);
  const security = scanSkillSecurity(files);

  let ok = true;
  if (options.threshold != null && review.score < options.threshold) ok = false;
  if (options.failOn) {
    const maxSev = security.issues.reduce<"low" | "medium" | "high" | "critical">((acc, i) => {
      const s = i.severity;
      return SEVERITY_RANK[s] > SEVERITY_RANK[acc] ? s : acc;
    }, "low");
    if (SEVERITY_RANK[maxSev] >= SEVERITY_RANK[options.failOn]) ok = false;
    if (security.status === "fail" && SEVERITY_RANK[options.failOn] <= SEVERITY_RANK.high) {
      ok = false;
    }
  }

  return {
    score: review.score,
    checks: review.checks,
    security: {
      status: security.status,
      score: security.score,
      issues: security.issues,
    },
    ok,
    exitCode: ok ? 0 : 1,
  };
}
