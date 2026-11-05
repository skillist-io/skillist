import { AGENT_MODEL_ID } from "../../agent/model-config";
import type { Env } from "../../env";

export type AgentModelHealth = {
  /** Which provider a chat turn uses. */
  provider: "workers-ai";
  model: string;
  /** Whether the Workers AI binding is present. */
  configured: boolean;
  ok: boolean;
  status: number | null;
  error: string | null;
};

/**
 * Report which model the platform agent runs and whether it can reach Workers
 * AI at all. This only confirms the binding exists: Workers AI has no free
 * credential check, and running the model would spend tokens on every probe.
 */
export function checkAgentModel(env: Env): AgentModelHealth {
  const configured = Boolean(env.AI);
  return {
    provider: "workers-ai",
    model: AGENT_MODEL_ID,
    configured,
    ok: configured,
    status: null,
    error: configured ? null : "The AI binding is missing",
  };
}
