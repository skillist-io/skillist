import { createAnthropic } from "@ai-sdk/anthropic";
import { type LanguageModel, wrapLanguageModel } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import type { Env } from "../env";
import { CLAUDE_MODEL_ID, WORKERS_MODEL_ID } from "./model-config";
import { workersAiFallback } from "./model-fallback";

/**
 * Build the language model for a turn. Prefers Claude for reliable tool-calling
 * (routed through the AI Gateway when configured for caching + observability);
 * falls back to a tool-capable Workers AI model so agents still run without the
 * Anthropic secret. Shared by the platform agent and the skills harness.
 */
export function buildAgentModel(
  env: Env,
  options: { sessionAffinity?: string } = {},
): LanguageModel {
  // sessionAffinity pins a conversation's turns to one Workers AI replica.
  const workers = createWorkersAI({ binding: env.AI })(WORKERS_MODEL_ID, {
    sessionAffinity: options.sessionAffinity,
  });
  // No Anthropic secret → run on Workers AI directly.
  if (!env.ANTHROPIC_API_KEY) return workers;

  const claude = createAnthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(env.AI_GATEWAY_ACCOUNT_ID
      ? {
          baseURL: `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/skillist/anthropic`,
          headers: env.AI_GATEWAY_TOKEN
            ? { "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}` }
            : undefined,
        }
      : {}),
  })(CLAUDE_MODEL_ID);

  // Claude for reliable tool-calling, but if its call FAILS TO START (a
  // bad/expired key, provider 4xx/5xx, gateway outage) fall back to Workers AI
  // for that turn instead of failing the whole agent. A single bad credential
  // used to take the agent fully down with no server-side log; now it degrades.
  return wrapLanguageModel({ model: claude, middleware: workersAiFallback(workers) });
}
