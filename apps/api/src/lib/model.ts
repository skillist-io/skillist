import type { Env } from "../env";

/** The Workers AI model used for skill improvement and eval scoring. */
export const MODEL = "@cf/meta/llama-3.1-8b-instruct";

/** The AI Gateway all model traffic is logged through. */
export const AI_GATEWAY_ID = "skillist";

/** Bounds a gateway call so a hung gateway can't stall the queue consumer. */
const GATEWAY_TIMEOUT_MS = 30_000;

/**
 * Runs a single-user-message completion against Workers AI through AI Gateway.
 * The binding authenticates to a gateway in the same account, so this needs no
 * account id or token. Returns the model's text, or "" when the response carries
 * no text.
 *
 * A gateway failure retries once on the binding directly, because logging must
 * never be the reason a feedback draft or eval fails. A failure there is NOT
 * caught — each caller decides its own fallback.
 */
export async function runModel(env: Env, prompt: string): Promise<string> {
  const input = { messages: [{ role: "user" as const, content: prompt }] };
  const text = (result: unknown) => (result as { response?: string }).response ?? "";

  try {
    return text(
      await env.AI.run(MODEL, input, {
        gateway: { id: AI_GATEWAY_ID, requestTimeoutMs: GATEWAY_TIMEOUT_MS },
      }),
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        msg: "ai_gateway_fallback",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return text(await env.AI.run(MODEL, input));
  }
}
