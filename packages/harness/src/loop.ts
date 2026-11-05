import { generateText, type LanguageModel, type ModelMessage, stepCountIs } from "ai";
import type { SkillCatalog } from "./catalog";
import { buildSystemPrompt } from "./prompt";
import { ACTIVATE_TOOL, createSkillTools, type SkillHost } from "./tools";

/** Model steps per turn. Each step is a billed call, so this bounds one turn's spend. */
export const MAX_STEPS_PER_TURN = 12;

export type TurnInput = {
  model: LanguageModel;
  catalog: SkillCatalog;
  host: SkillHost;
  /** The session so far, replayed in full. */
  history: ModelMessage[];
  message: string;
  allowScripts: boolean;
  abortSignal?: AbortSignal;
  /** Called after each model step, so a host can keep its turn lease alive. */
  onStep?: () => Promise<void>;
};

export type TurnResult = {
  text: string;
  /** This turn's messages, for the caller to append to the session log. */
  messages: ModelMessage[];
  steps: number;
  finishReason: string;
  inputTokens: number;
  outputTokens: number;
};

/**
 * Which skills the session has activated, read back from the log so a turn
 * needs no state beyond the messages. Only a successful activation counts: a
 * model that guessed a name doesn't unlock anything.
 */
export function activatedSkills(history: readonly ModelMessage[]): Set<string> {
  const activated = new Set<string>();
  for (const message of history) {
    if (message.role !== "tool") continue;
    for (const part of message.content) {
      if (part.type !== "tool-result" || part.toolName !== ACTIVATE_TOOL) continue;
      if (part.output.type !== "json") continue;
      const value = part.output.value as { ok?: unknown; skill?: unknown } | null;
      if (value?.ok === true && typeof value.skill === "string") activated.add(value.skill);
    }
  }
  return activated;
}

export async function runTurn(input: TurnInput): Promise<TurnResult> {
  const { model, catalog, host, history, message, allowScripts, abortSignal, onStep } = input;
  const user: ModelMessage = { role: "user", content: message };

  const result = await generateText({
    model,
    system: buildSystemPrompt(catalog, allowScripts),
    messages: [...history, user],
    tools: createSkillTools({
      catalog,
      host,
      activated: activatedSkills(history),
      allowScripts,
    }),
    stopWhen: stepCountIs(MAX_STEPS_PER_TURN),
    abortSignal,
    onStepFinish: async () => {
      await onStep?.();
    },
  });

  return {
    text: result.text,
    // Per step, not `result.response.messages`: that holds only the final step,
    // so every tool call and result would silently drop out of the session log.
    messages: [user, ...result.steps.flatMap((step) => step.response.messages)],
    steps: result.steps.length,
    finishReason: result.finishReason,
    inputTokens: result.totalUsage.inputTokens ?? 0,
    outputTokens: result.totalUsage.outputTokens ?? 0,
  };
}
