import type { SkillBundle, SkillFrontmatter } from "./index.js";
import { validateSkillBundle } from "./index.js";

export type ReviewCheck = {
  id: string;
  label: string;
  passed: boolean;
  message: string;
  weight: number;
};

export type SkillReviewResult = {
  score: number;
  checks: ReviewCheck[];
};

export function reviewSkillBundle(files: SkillBundle, expectedSlug?: string): SkillReviewResult {
  const checks: ReviewCheck[] = [];
  const validation = validateSkillBundle(files, expectedSlug);

  checks.push({
    id: "valid-bundle",
    label: "agentskills.io bundle valid",
    passed: validation.valid,
    message: validation.valid
      ? "Bundle passes agentskills.io validation"
      : validation.errors.map((e: { message: string }) => e.message).join("; "),
    weight: 30,
  });

  if (!validation.valid) {
    return { score: 0, checks };
  }

  const { frontmatter, body } = validation;
  checks.push(...reviewFrontmatter(frontmatter));
  checks.push(...reviewBody(body));
  checks.push(...reviewStructure(files));

  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const earned = checks.filter((c) => c.passed).reduce((s, c) => s + c.weight, 0);
  const score = totalWeight > 0 ? Math.round((earned / totalWeight) * 100) : 0;

  return { score, checks };
}

function reviewFrontmatter(fm: SkillFrontmatter): ReviewCheck[] {
  return [
    {
      id: "description-length",
      label: "Description length",
      passed: fm.description.length >= 20 && fm.description.length <= 500,
      message:
        fm.description.length >= 20
          ? "Description is substantive"
          : "Description should be at least 20 characters",
      weight: 15,
    },
    {
      id: "license-metadata",
      label: "License or metadata",
      passed: Boolean(fm.license || (fm.metadata && Object.keys(fm.metadata).length > 0)),
      message: "Includes license or metadata for discoverability",
      weight: 5,
    },
    {
      id: "compatibility",
      label: "Compatibility notes",
      passed: Boolean(fm.compatibility && fm.compatibility.length > 0),
      message: "Documents agent/environment compatibility",
      weight: 5,
    },
  ];
}

function reviewBody(body: string): ReviewCheck[] {
  const trimmed = body.trim();
  const headings = (trimmed.match(/^#+\s/gm) ?? []).length;
  const hasSteps = /^\d+\.|^-\s/m.test(trimmed);
  return [
    {
      id: "body-length",
      label: "Instruction body",
      passed: trimmed.length >= 100,
      message:
        trimmed.length >= 100
          ? "Body has sufficient instruction content"
          : "Body should be at least 100 characters",
      weight: 15,
    },
    {
      id: "headings",
      label: "Structured headings",
      passed: headings >= 1,
      message: "Uses markdown headings for structure",
      weight: 10,
    },
    {
      id: "actionable-steps",
      label: "Actionable steps",
      passed: hasSteps,
      message: "Includes numbered or bulleted steps",
      weight: 10,
    },
  ];
}

function reviewStructure(files: SkillBundle): ReviewCheck[] {
  const hasScripts = [...files.keys()].some((p) => p.startsWith("scripts/"));
  const hasReferences = [...files.keys()].some((p) => p.startsWith("references/"));
  const hasPlugin = files.has("plugin.json");
  return [
    {
      id: "scripts-dir",
      label: "Scripts directory",
      passed: hasScripts,
      message: hasScripts
        ? "Includes executable scripts"
        : "Optional scripts/ directory not present",
      weight: 5,
    },
    {
      id: "references-dir",
      label: "References directory",
      passed: hasReferences,
      message: hasReferences
        ? "Includes reference docs"
        : "Optional references/ directory not present",
      weight: 5,
    },
    {
      id: "plugin-manifest",
      label: "Plugin manifest",
      passed: hasPlugin,
      message: hasPlugin ? "plugin.json present for bundled context" : "No plugin.json (optional)",
      weight: 5,
    },
  ];
}

/** Heuristic impact estimate from review signals (v1 — no agent run). */
export function estimateImpactScore(review: SkillReviewResult): number {
  const base = review.score;
  const bonus = review.checks.filter(
    (c) => c.passed && ["scripts-dir", "actionable-steps", "body-length"].includes(c.id),
  ).length;
  return Math.min(100, Math.round(base * 0.7 + bonus * 10));
}
