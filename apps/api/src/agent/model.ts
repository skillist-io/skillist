import { type LanguageModel, wrapLanguageModel } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import type { Env } from "../env";
import { AGENT_FALLBACK_MODEL_ID, AGENT_MODEL_ID, AI_GATEWAY_ID } from "./model-config";
import { workersAiFallback } from "./model-fallback";

/**
 * Build the language model for a turn, entirely on Workers AI. Shared by the
 * platform agent and the skills harness.
 *
 * The primary goes through AI Gateway when one is configured, for logging and
 * caching. The fallback calls the binding directly on purpose: if it shared the
 * gateway, one gateway outage would take down both models.
 */
export function buildAgentModel(
  env: Env,
  options: { sessionAffinity?: string } = {},
): LanguageModel {
  // sessionAffinity pins a conversation's turns to one Workers AI replica.
  const settings = { sessionAffinity: options.sessionAffinity };
  const primary = createWorkersAI({
    binding: env.AI,
    ...(env.AI_GATEWAY_ACCOUNT_ID ? { gateway: { id: AI_GATEWAY_ID } } : {}),
  })(AGENT_MODEL_ID, settings);
  const fallback = createWorkersAI({ binding: env.AI })(AGENT_FALLBACK_MODEL_ID, settings);

  return wrapLanguageModel({ model: primary, middleware: workersAiFallback(fallback) });
}
