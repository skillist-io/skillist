import { parseSkillMd, type SkillBundle, skillFrontmatterSchema } from "@skillist/skill-format";

/** A skill as one session sees it. Addressed by `org/repo`: names repeat across orgs. */
export type HarnessSkill = {
  ref: string;
  name: string;
  description: string;
  body: string;
  /** Bundle paths `read_skill_file` may return. Binary assets are left out. */
  files: string[];
  /** Runnable `scripts/*` paths. Empty when the skill has no hosted runtime. */
  scripts: string[];
  /** False for `disable-model-invocation`, which hides the skill from the model entirely. */
  modelInvocable: boolean;
};

export type SkillCatalog = {
  /** What the model is offered, sorted so the prompt prefix stays byte-stable for caching. */
  listed(): HarnessSkill[];
  /** A skill the model may use. A hidden skill answers as if it doesn't exist. */
  get(ref: string): HarnessSkill | undefined;
};

export function buildSkill(
  ref: string,
  bundle: SkillBundle,
  scripts: readonly string[],
): HarnessSkill | null {
  const raw = bundle.get("SKILL.md");
  if (raw === undefined) return null;
  const parsed = parseSkillMd(raw);
  if (!parsed) return null;
  const frontmatter = skillFrontmatterSchema.safeParse(parsed.frontmatter);
  if (!frontmatter.success) return null;

  // Read from the raw YAML: the schema strips keys it doesn't declare, and this
  // one comes from Claude Code's frontmatter rather than agentskills.io.
  const hidden =
    (parsed.frontmatter as Record<string, unknown>)["disable-model-invocation"] === true;

  return {
    ref,
    name: frontmatter.data.name,
    description: frontmatter.data.description,
    body: parsed.body,
    files: [...bundle.keys()].filter((path) => !path.startsWith("assets/")).sort(),
    scripts: [...scripts].sort(),
    modelInvocable: !hidden,
  };
}

export function createCatalog(skills: readonly HarnessSkill[]): SkillCatalog {
  const offered = skills.filter((s) => s.modelInvocable);
  const byRef = new Map(offered.map((s) => [s.ref, s]));
  const listed = [...offered].sort((a, b) => a.ref.localeCompare(b.ref));
  return { listed: () => listed, get: (ref) => byRef.get(ref) };
}
