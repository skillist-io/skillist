import { parseSkillMd, type ValidationError } from "@skillist/skill-format";

/**
 * Maps `frontmatter.<key>` validation errors to 1-indexed lines inside the
 * YAML fence by scanning for `<key>:` at line start. Structural errors and
 * unmatched keys anchor to line 1. Deliberately shallow — no YAML positions.
 */
export function errorLinesForSkillMd(content: string, errors: ValidationError[]): Set<number> {
  const lines = new Set<number>();
  if (errors.length === 0) return lines;
  const parsed = parseSkillMd(content);
  const yamlLines = parsed ? parsed.yamlText.split("\n") : [];

  for (const error of errors) {
    if (
      !error.path.startsWith("frontmatter.") &&
      error.path !== "SKILL.md" &&
      error.path !== "name"
    ) {
      continue;
    }
    const key = error.path.startsWith("frontmatter.")
      ? (error.path.split(".")[1] ?? "")
      : error.path === "name"
        ? "name"
        : "";
    const index = key ? yamlLines.findIndex((line) => line.startsWith(`${key}:`)) : -1;
    // +2: line 1 is the opening fence, yaml starts on line 2.
    lines.add(index === -1 ? 1 : index + 2);
  }
  return lines;
}
