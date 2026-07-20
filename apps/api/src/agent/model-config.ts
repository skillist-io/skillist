/**
 * Platform-agent model IDs, shared by the agent (`skillist-agent.ts`) and the
 * agent-health check so a health probe validates the SAME model the agent runs.
 */

/** Anthropic Claude — primary, for reliable tool-calling. */
export const CLAUDE_MODEL_ID = "claude-sonnet-5";

/** Workers AI fallback — used when no Anthropic key, or when Claude fails. */
export const WORKERS_MODEL_ID = "@cf/meta/llama-4-scout-17b-16e-instruct";
