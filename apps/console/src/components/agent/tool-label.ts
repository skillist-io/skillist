function str(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const v = (input as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** What the call acted on. `skillRepo` and `key` are the server's actual input names. */
function targetOf(input: unknown): string | undefined {
  const ref =
    str(input, "ref") ?? str(input, "skill") ?? str(input, "repo") ?? str(input, "skillRepo");
  const org = str(input, "org") ?? str(input, "orgSlug");
  return (ref ? (org && !ref.includes("/") ? `${org}/${ref}` : ref) : org) ?? str(input, "key");
}

type ToolWords = {
  /** Present tense, while it runs. */
  running: string;
  /** Past tense. Only ever shown for a call that really succeeded. */
  done: string;
  /** The bare action, for any outcome where it did not happen. */
  attempt: string;
  /** Word between the phrase and its target, when it reads badly without one. */
  join?: string;
};

const TOOLS: Record<string, ToolWords> = {
  search_registry: {
    running: "Searching the registry",
    done: "Searched the registry",
    attempt: "Search the registry",
  },
  get_skill: { running: "Reading skill", done: "Read skill", attempt: "Read skill" },
  registry_facets: {
    running: "Reading registry facets",
    done: "Read registry facets",
    attempt: "Read registry facets",
  },
  validate_skill: {
    running: "Validating skill",
    done: "Validated skill",
    attempt: "Validate skill",
  },
  search_docs: {
    running: "Searching the docs",
    done: "Searched the docs",
    attempt: "Search the docs",
  },
  list_org_skills: {
    running: "Listing org skills",
    done: "Listed org skills",
    attempt: "List org skills",
  },
  get_coverage: {
    running: "Checking coverage",
    done: "Checked required-skill coverage",
    attempt: "Check required-skill coverage",
  },
  list_recurring_failures: {
    running: "Scanning for recurring failures",
    done: "Listed recurring failures",
    attempt: "List recurring failures",
  },
  list_required_skills: {
    running: "Reading required skills",
    done: "Listed required skills",
    attempt: "List required skills",
  },
  recommend_required_skills: {
    running: "Weighing skills to require",
    done: "Recommended required skills",
    attempt: "Recommend required skills",
  },
  flag_stale_evals: {
    running: "Checking evals for staleness",
    done: "Flagged stale evals",
    attempt: "Flag stale evals",
  },
  draft_improvement: {
    running: "Drafting improvement",
    done: "Drafted improvement",
    attempt: "Draft improvement",
    join: "for",
  },
  remember: { running: "Saving fact", done: "Saved fact", attempt: "Save fact" },
  search_memory: {
    running: "Searching memory",
    done: "Searched memory",
    attempt: "Search memory",
  },
  forget: { running: "Forgetting fact", done: "Forgot fact", attempt: "Forget fact" },
  run_approved_action: {
    running: "Running the approved action",
    done: "Ran the approved action",
    attempt: "Run the approved action",
  },
};

/** Tools that change something. These stay visible rather than folding into a group. */
export const WRITE_TOOLS = new Set([
  "draft_improvement",
  "remember",
  "forget",
  "run_approved_action",
]);

function withTarget(words: ToolWords, phrase: string, input: unknown): string {
  const target = targetOf(input);
  if (!target) return phrase;
  return words.join ? `${phrase} ${words.join} ${target}` : `${phrase} ${target}`;
}

function humanize(toolName: string): string {
  return toolName.replace(/[_-]+/g, " ").trim();
}

/**
 * Map an agent tool call to a compact, tense-aware status line. Unknown tools
 * fall back to the humanized tool name, so a new server tool renders sanely
 * before the client knows about it.
 */
export function toolLabel(toolName: string, input: unknown, done: boolean): string {
  const words = TOOLS[toolName];
  if (!words) return done ? humanize(toolName) : `${humanize(toolName)}…`;
  if (done) return withTarget(words, words.done, input);
  return `${withTarget(words, words.running, input)}…`;
}

/** The action named without claiming it happened, for awaiting/denied/refused/failed rows. */
export function toolAttempt(toolName: string, input: unknown): string {
  const words = TOOLS[toolName];
  return words ? withTarget(words, words.attempt, input) : humanize(toolName);
}
