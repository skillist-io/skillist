function str(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const v = (input as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/**
 * Map an agent tool call to a compact, tense-aware status line. The agent's
 * tools are fixed (get_coverage, list_recurring_failures, list_required_skills,
 * recommend_required_skills, flag_stale_evals, draft_improvement); unknown
 * tools fall back to the humanized tool name so new server tools render sanely
 * without a client change.
 */
export function toolLabel(toolName: string, input: unknown, done: boolean): string {
  const ref = str(input, "ref") ?? str(input, "skill") ?? str(input, "repo");
  const org = str(input, "org") ?? str(input, "orgSlug");
  const target = ref ? (org && !ref.includes("/") ? `${org}/${ref}` : ref) : org;

  switch (toolName) {
    case "get_coverage":
      return done ? "Checked required-skill coverage" : "Checking coverage…";
    case "list_recurring_failures":
      return done ? "Listed recurring failures" : "Scanning for recurring failures…";
    case "list_required_skills":
      return done ? "Listed required skills" : "Reading required skills…";
    case "recommend_required_skills":
      return done ? "Recommended required skills" : "Weighing skills to require…";
    case "flag_stale_evals":
      return done ? "Flagged stale evals" : "Checking evals for staleness…";
    case "draft_improvement":
      return target
        ? done
          ? `Drafted improvement for ${target}`
          : `Drafting improvement for ${target}…`
        : done
          ? "Drafted improvement"
          : "Drafting improvement…";
    default: {
      const humanized = toolName.replace(/[_-]+/g, " ").trim();
      return done ? humanized : `${humanized}…`;
    }
  }
}
