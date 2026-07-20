import { CLAUDE_MODEL_ID, WORKERS_MODEL_ID } from "../../agent/model-config";
import type { Env } from "../../env";

export type AgentModelHealth = {
  /** Which provider a chat turn would use right now. */
  provider: "anthropic" | "workers-ai";
  model: string;
  /** Whether an Anthropic key is configured at all. */
  configured: boolean;
  /** Whether that key authenticates (always true on the Workers AI path). */
  ok: boolean;
  status: number | null;
  error: string | null;
};

/**
 * Probe whether the platform agent's configured model is usable, WITHOUT
 * spending tokens. Hits Anthropic's `GET /v1/models/{id}`, which validates both
 * the API key (401 on a bad key) and the model id (404 if it doesn't exist) but
 * generates nothing. When no key is set, the agent runs on Workers AI, which
 * needs no external auth — reported as healthy.
 *
 * This exists because a bad/expired ANTHROPIC_API_KEY silently degraded the
 * agent to the weaker Workers AI model (or, before the fallback, took it down);
 * an admin can now catch that here instead of on a user's first turn.
 */
export async function checkAgentModel(env: Env): Promise<AgentModelHealth> {
  if (!env.ANTHROPIC_API_KEY) {
    return {
      provider: "workers-ai",
      model: WORKERS_MODEL_ID,
      configured: false,
      ok: true,
      status: null,
      error: null,
    };
  }

  try {
    const res = await fetch(`https://api.anthropic.com/v1/models/${CLAUDE_MODEL_ID}`, {
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
    });
    if (res.ok) {
      return {
        provider: "anthropic",
        model: CLAUDE_MODEL_ID,
        configured: true,
        ok: true,
        status: res.status,
        error: null,
      };
    }
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return {
      provider: "anthropic",
      model: CLAUDE_MODEL_ID,
      configured: true,
      ok: false,
      status: res.status,
      error: body.error?.message ?? `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      provider: "anthropic",
      model: CLAUDE_MODEL_ID,
      configured: true,
      ok: false,
      status: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
