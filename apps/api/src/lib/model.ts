import type { Env } from "../env";

/** The Workers AI model used for skill improvement and eval scoring. */
export const MODEL = "@cf/deepseek-ai/deepseek-v4-flash-0731";

/**
 * Room for a full improved SKILL.md. The model's reasoning counts against this
 * too, and a cut-off draft would be saved as if it were complete.
 */
const MAX_TOKENS = 8192;

/** The AI Gateway all model traffic is logged through. */
export const AI_GATEWAY_ID = "skillist";

/**
 * For calls that want one short, repeatable answer, such as a score. Thinking off
 * stops runaway reasoning, which could spend the whole token budget and return
 * nothing. Temperature 0 gives the same score for the same input.
 */
export const DETERMINISTIC = {
  temperature: 0,
  max_tokens: 64,
  chat_template_kwargs: { enable_thinking: false },
};

/**
 * Keeps prompts and responses out of AI Gateway logs, which hold agent chats and
 * private skill content. Metadata such as model, status, tokens and timing is
 * still logged. AI Gateway only offers this per request, so every gateway call
 * has to send it.
 */
export const NO_PAYLOAD_LOGGING = { "cf-aig-collect-log-payload": "false" };

/**
 * Bounds a gateway call so a hung gateway can't stall the queue consumer. Long
 * enough for a reasoning model to write a full SKILL.md.
 */
const GATEWAY_TIMEOUT_MS = 120_000;

/**
 * Runs a single-user-message completion against Workers AI through AI Gateway.
 * The binding authenticates to a gateway in the same account, so this needs no
 * account id or token. Returns the model's text.
 *
 * Throws when the model returns no text. Callers used to treat "" as a valid
 * answer, which is how a deprecated model went unnoticed: every eval scored a
 * default 50 and looked like a real result.
 *
 * A gateway failure retries once on the binding directly, because logging must
 * never be the reason a feedback draft or eval fails. A failure there is NOT
 * caught — each caller decides its own fallback.
 */
export async function runModel(
  env: Env,
  prompt: string,
  options: Partial<typeof DETERMINISTIC> = {},
): Promise<string> {
  const input = {
    messages: [{ role: "user" as const, content: prompt }],
    max_tokens: MAX_TOKENS,
    ...options,
  };

  try {
    return responseText(
      await env.AI.run(MODEL, input, {
        gateway: { id: AI_GATEWAY_ID, requestTimeoutMs: GATEWAY_TIMEOUT_MS },
        extraHeaders: NO_PAYLOAD_LOGGING,
      }),
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        msg: "ai_gateway_fallback",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return responseText(await env.AI.run(MODEL, input));
  }
}

/** Workers AI models answer in one of two shapes: `response`, or OpenAI-style `choices`. */
function responseText(result: unknown): string {
  const { response, choices } = result as {
    response?: string;
    choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  };
  const choice = choices?.[0];
  const text = response ?? choice?.message?.content;
  if (!text?.trim()) throw new Error("The model returned no text");
  // A cut-off SKILL.md would otherwise be saved as a complete draft.
  if (choice?.finish_reason === "length") throw new Error("The model's reply was cut off");
  return text;
}
