import type { LanguageModelMiddleware } from "ai";

/**
 * The subset of a language model we re-dispatch to when the primary fails.
 * Typed loosely on the call options because this is version-bridging glue: the
 * AI SDK normalizes call options across model spec versions at runtime, but the
 * static types for the (V4) middleware and a provider model don't line up. The
 * behavior is a thin pass-through, so the looseness costs no real safety.
 */
type FallbackModel = {
  // biome-ignore lint/suspicious/noExplicitAny: version-bridging glue, see above.
  doStream: (options: any) => any;
  // biome-ignore lint/suspicious/noExplicitAny: version-bridging glue, see above.
  doGenerate: (options: any) => any;
};

/**
 * Run `primary`; on a start-time throw, log it and re-dispatch to `fallback`.
 * Extracted (and unit-tested) separately from the middleware so the control
 * flow is verifiable without the AI SDK runtime.
 */
export async function withFallback<T>(
  stage: string,
  primary: () => Promise<T> | T,
  fallback: () => Promise<T> | T,
): Promise<T> {
  try {
    return await primary();
  } catch (err) {
    console.error(
      JSON.stringify({
        msg: "agent_model_fallback",
        stage,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return await fallback();
  }
}

/**
 * Middleware that keeps the agent responsive when the primary model's call
 * FAILS TO START — an auth error (bad/expired key), a provider 4xx/5xx, or a
 * gateway outage — by transparently retrying that turn on `fallback` (Workers
 * AI). Only pre-first-token failures fall back cleanly; an error mid-stream
 * still surfaces. The outage class we care about — an invalid ANTHROPIC_API_KEY —
 * fails before any tokens, so this turns a total agent outage into a
 * degraded-but-live turn (Workers AI is weaker at tool-calling, but it answers).
 */
export function workersAiFallback(fallback: FallbackModel): LanguageModelMiddleware {
  return {
    wrapStream: ({ doStream, params }) =>
      withFallback(
        "stream",
        () => doStream(),
        () => fallback.doStream(params),
      ),
    wrapGenerate: ({ doGenerate, params }) =>
      withFallback(
        "generate",
        () => doGenerate(),
        () => fallback.doGenerate(params),
      ),
  };
}
