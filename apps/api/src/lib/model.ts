import type { Env } from "../env";

/** The Workers AI model used for skill improvement and eval scoring. */
export const MODEL = "@cf/meta/llama-3.1-8b-instruct";

/**
 * Runs a single-user-message completion against Workers AI, routed through the
 * AI Gateway when it is configured (for caching + observability) and falling
 * back to the direct `env.AI` binding otherwise. Returns the model's text
 * response, or "" when the response carries no text. Errors are NOT caught here
 * — each caller decides its own fallback.
 */
export async function runModel(env: Env, prompt: string): Promise<string> {
  if (env.AI_GATEWAY_ACCOUNT_ID && env.AI_GATEWAY_TOKEN) {
    const gatewayUrl = `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/skillist/workers-ai/${MODEL}`;
    const res = await fetch(gatewayUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.AI_GATEWAY_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
    });
    const data = (await res.json()) as { result?: { response?: string } };
    return data.result?.response ?? "";
  }
  const result = await env.AI.run(MODEL, {
    messages: [{ role: "user", content: prompt }],
  });
  return (result as { response?: string }).response ?? "";
}
