import { type ToolSet, tool } from "ai";
import { z } from "zod";
import type { SkillCatalog } from "./catalog";

/** What one `read_skill_file` or `activate_skill` returns at most. */
export const MAX_CONTENT_CHARS = 64 * 1024;
/** What one script stream returns at most. The full output stays on the run record. */
export const MAX_OUTPUT_CHARS = 16 * 1024;

/**
 * What all of one turn's tools return together. A step can make any number of
 * parallel calls, and one step's results land in a single logged message, so
 * this keeps that message under the session log's ~2 MB row limit.
 */
export const MAX_TURN_CONTENT_CHARS = 1024 * 1024;

export const ACTIVATE_TOOL = "activate_skill";

export type ScriptResult =
  | { ok: true; runId: string; exitCode: number; stdout: string; stderr: string }
  /** `error` reaches the model, so hosts return a fixed code and never raw exception text. */
  | { ok: false; error: string };

/**
 * Everything the harness needs from its platform. The host owns authorization:
 * these run with the caller's live credentials, so a revoked key stops working
 * mid-session rather than at the next session.
 */
export type SkillHost = {
  readFile(ref: string, path: string): Promise<string | null>;
  runScript(ref: string, path: string, args: string[]): Promise<ScriptResult>;
  onActivate?(ref: string): Promise<void>;
};

function clip(text: string, limit: number): { text: string; truncated: boolean } {
  return text.length > limit
    ? { text: text.slice(0, limit), truncated: true }
    : { text, truncated: false };
}

const unknownSkill = { ok: false as const, error: "unknown_skill" };
const notActivated = { ok: false as const, error: "skill_not_activated" };
const budgetSpent = { ok: false as const, error: "turn_output_budget_exceeded" };

export function createSkillTools(options: {
  catalog: SkillCatalog;
  host: SkillHost;
  /** Refs already activated this session. Mutated as the model activates more. */
  activated: Set<string>;
  allowScripts: boolean;
}): ToolSet {
  const { catalog, host, activated, allowScripts } = options;

  // Built once per turn, so this spans every tool call the turn makes. A script
  // is refused up front: its cost is only known after it has run.
  let budget = MAX_TURN_CONTENT_CHARS;
  const spend = (chars: number): boolean => {
    if (chars > budget) return false;
    budget -= chars;
    return true;
  };

  const skillRef = z.string().min(1).max(200).describe("The skill's ref, as org/repo.");

  const tools: ToolSet = {
    list_skills: tool({
      description: "List the skills available in this session.",
      inputSchema: z.object({}),
      execute: async () => ({
        ok: true as const,
        skills: catalog.listed().map(({ ref, name, description }) => ({ ref, name, description })),
      }),
    }),

    [ACTIVATE_TOOL]: tool({
      description:
        "Load a skill's instructions and list its files. Call this before using a skill.",
      inputSchema: z.object({ skill: skillRef }),
      execute: async ({ skill: ref }) => {
        const skill = catalog.get(ref);
        if (!skill) return unknownSkill;
        const { text, truncated } = clip(skill.body, MAX_CONTENT_CHARS);
        if (!spend(text.length)) return budgetSpent;
        const firstActivation = !activated.has(ref);
        activated.add(ref);
        if (firstActivation) await host.onActivate?.(ref);
        return {
          ok: true as const,
          skill: ref,
          instructions: text,
          truncated,
          files: skill.files,
          scripts: allowScripts ? skill.scripts : [],
        };
      },
    }),

    read_skill_file: tool({
      description: "Read a text file that activate_skill listed, such as references/guide.md.",
      inputSchema: z.object({
        skill: skillRef,
        path: z.string().min(1).max(512).describe("A path from the skill's file list."),
      }),
      execute: async ({ skill: ref, path }) => {
        const skill = catalog.get(ref);
        if (!skill) return unknownSkill;
        if (!activated.has(ref)) return notActivated;
        // Matched against the list, never resolved: a path that isn't listed
        // verbatim can't traverse anywhere.
        if (!skill.files.includes(path)) return { ok: false as const, error: "unknown_file" };
        const content = await host.readFile(ref, path);
        if (content === null) return { ok: false as const, error: "unknown_file" };
        const { text, truncated } = clip(content, MAX_CONTENT_CHARS);
        if (!spend(text.length)) return budgetSpent;
        return { ok: true as const, path, content: text, truncated };
      },
    }),
  };

  // Left out rather than refused: a model can't call a tool it was never given,
  // whatever a skill's instructions tell it to try.
  if (allowScripts) {
    tools.run_skill_script = tool({
      description: "Run a script that activate_skill listed, in an isolated sandbox.",
      inputSchema: z.object({
        skill: skillRef,
        path: z.string().min(1).max(512).describe("A path from the skill's script list."),
        args: z.array(z.string().max(512)).max(20).optional(),
      }),
      execute: async ({ skill: ref, path, args }) => {
        const skill = catalog.get(ref);
        if (!skill) return unknownSkill;
        if (!activated.has(ref)) return notActivated;
        if (!skill.scripts.includes(path)) return { ok: false as const, error: "unknown_script" };
        if (!spend(MAX_OUTPUT_CHARS * 2)) return budgetSpent;
        const result = await host.runScript(ref, path, args ?? []);
        if (!result.ok) return result;
        const stdout = clip(result.stdout, MAX_OUTPUT_CHARS);
        const stderr = clip(result.stderr, MAX_OUTPUT_CHARS);
        return {
          ok: true as const,
          runId: result.runId,
          exitCode: result.exitCode,
          stdout: stdout.text,
          stderr: stderr.text,
          truncated: stdout.truncated || stderr.truncated,
        };
      },
    });
  }

  return tools;
}
