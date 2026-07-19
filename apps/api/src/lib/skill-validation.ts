import { type SecurityIssue, scanSkillSecurity, validateSkillBundle } from "@skillist/skill-format";

/**
 * Compliance report for a single authored SKILL.md, shaped so the platform agent
 * can tell an author exactly what is non-compliant with the agentskills.io spec.
 */
export type SkillValidationReport = {
  valid: boolean;
  errors: { path: string; message: string }[];
  securityStatus: "pass" | "advisory" | "fail";
  securityIssues: SecurityIssue[];
};

/**
 * Builds a one-file bundle from a SKILL.md string and runs the same
 * spec-validation + security scan the publish path uses (`validateSkillBundle` +
 * `scanSkillSecurity` from @skillist/skill-format). Pure — no DB, KV, or network,
 * so it is safe to call from the agent tool and to unit-test directly.
 *
 * @param skillMd the full SKILL.md contents (YAML frontmatter + body)
 * @param repo    optional expected slug; when set, the skill `name` must match it
 */
export function validateSkillMd(skillMd: string, repo?: string): SkillValidationReport {
  // A SKILL.md string alone is a valid (minimal) bundle: the required file is
  // SKILL.md; scripts/references/assets are optional. Mirrors how the publish
  // path constructs a SkillBundle Map (see lib/ai.ts) before validating.
  const bundle = new Map<string, string>([["SKILL.md", skillMd]]);
  const validation = validateSkillBundle(bundle, repo);
  const security = scanSkillSecurity(bundle);

  return {
    valid: validation.valid,
    errors: validation.valid ? [] : validation.errors,
    securityStatus: security.status,
    securityIssues: security.issues,
  };
}
