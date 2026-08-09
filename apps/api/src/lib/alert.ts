import type { Env } from "../env";
import { isProductionEnv } from "./db";
import { describeError, type ErrorDetail } from "./error-detail";

/**
 * Outbound alerting for unhandled server errors.
 *
 * Workers Logs records every failure, but nothing reads it unprompted — the
 * failures this module exists for ran for a day each before anyone noticed. So
 * the alert is pushed from the point of failure rather than polled out of the
 * logs, which also means it can carry the cause chain: Workers Logs only indexes
 * `$metadata.*`, so our structured fields are not queryable there.
 *
 * Three rules shape everything below.
 *
 * 1. An alert must never affect the response. Every path here is best-effort,
 *    swallows its own errors, and runs under `waitUntil`.
 * 2. An alert must never carry payload data. Email and Slack are outside our
 *    trust boundary, and a Drizzle failure's message is the full SQL *and its
 *    bound params* — which can be an API-key hash or an email address. Alerts
 *    carry identifiers (route, error code, correlation id); the log keeps the
 *    detail. Follow the correlation id to get the rest.
 * 3. An alert must be rare enough to stay believed. See the dedupe below.
 */

/** Suppression window for a repeat of the same failure. */
const DEDUPE_TTL_SECONDS = 3600;

/** Ceiling on alerts per window, across all fingerprints. */
const GLOBAL_BUDGET = 10;
const GLOBAL_BUDGET_KEY = "alert:budget";

export type AlertContext = {
  correlationId: string;
  method: string;
  path: string;
};

/**
 * Collapses a path to its route shape so one broken route is one fingerprint.
 *
 * `/v1/orgs/<uuid>/observability` must not be a different alert per org, or a
 * single bug pages once per tenant and the dedupe below buys nothing.
 */
export function routeShape(path: string): string {
  return path
    .split("/")
    .map((segment) => {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) {
        return "{id}";
      }
      // Long opaque segments (hashes, tokens in a path) are identifiers too.
      if (/^[0-9a-f]{16,}$/i.test(segment)) return "{hash}";
      return segment;
    })
    .join("/");
}

/**
 * What makes two failures "the same". Route shape plus the innermost error code
 * — so a connection drop and a constraint violation on one route stay distinct,
 * while the same fault repeating is one alert.
 */
export function fingerprint(
  path: string,
  detail: ErrorDetail & { causes?: ErrorDetail[] },
): string {
  const root = detail.causes?.[detail.causes.length - 1] ?? detail;
  return `${routeShape(path)}|${root.code ?? root.name ?? "unknown"}`;
}

/**
 * A body safe to send off-platform: identifiers only, no message text.
 *
 * Deliberately excludes `message` at every level. A Drizzle message carries the
 * query and its bound params; a Postgres one can echo row values. The
 * correlation id is the join key back to the full detail in Workers Logs.
 */
function alertSummary(ctx: AlertContext, detail: ErrorDetail & { causes?: ErrorDetail[] }) {
  const root = detail.causes?.[detail.causes.length - 1] ?? detail;
  return {
    route: `${ctx.method} ${routeShape(ctx.path)}`,
    errorType: root.name ?? "Error",
    errorCode: root.code ?? null,
    severity: root.severity ?? null,
    constraint: root.constraint ?? null,
    correlationId: ctx.correlationId,
  };
}

/**
 * True when this fingerprint should alert now — first sighting in the window,
 * and inside the global budget.
 *
 * Both checks are read-then-write against KV, so concurrent isolates can each
 * decide to send. That race costs a duplicate alert, which is the right way to
 * be wrong: a missed alert is the failure mode this module exists to prevent.
 */
async function shouldAlert(env: Env, key: string): Promise<boolean> {
  const seen = await env.SKILLS_KV.get(`alert:seen:${key}`);
  if (seen) return false;

  const spent = Number((await env.SKILLS_KV.get(GLOBAL_BUDGET_KEY)) ?? "0");
  if (spent >= GLOBAL_BUDGET) return false;

  await Promise.all([
    env.SKILLS_KV.put(`alert:seen:${key}`, "1", { expirationTtl: DEDUPE_TTL_SECONDS }),
    env.SKILLS_KV.put(GLOBAL_BUDGET_KEY, String(spent + 1), {
      expirationTtl: DEDUPE_TTL_SECONDS,
    }),
  ]);
  return true;
}

async function postToSlack(webhookUrl: string, summary: ReturnType<typeof alertSummary>) {
  const lines = [
    `*Unhandled error* — \`${summary.route}\``,
    `type: \`${summary.errorType}\`${summary.errorCode ? ` · code: \`${summary.errorCode}\`` : ""}`,
    summary.constraint ? `constraint: \`${summary.constraint}\`` : null,
    `correlation id: \`${summary.correlationId}\``,
    `_Repeats of this fault are suppressed for the next hour._`,
  ].filter(Boolean);

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: lines.join("\n") }),
  });
}

async function sendAlertEmail(env: Env, to: string, summary: ReturnType<typeof alertSummary>) {
  const text = [
    `Unhandled error on ${summary.route}`,
    "",
    `Type:           ${summary.errorType}`,
    `Code:           ${summary.errorCode ?? "—"}`,
    `Severity:       ${summary.severity ?? "—"}`,
    `Constraint:     ${summary.constraint ?? "—"}`,
    `Correlation id: ${summary.correlationId}`,
    "",
    "Full detail is in Workers Logs — search the correlation id.",
    "Repeats of this fault are suppressed for the next hour.",
  ].join("\n");

  await env.EMAIL.send({
    to,
    from: "welcome@skillist.io",
    subject: `[skillist] Unhandled error — ${summary.route}`,
    text,
    html: `<pre style="font:13px/1.5 ui-monospace,monospace">${text.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"))}</pre>`,
  });
}

/**
 * Alert on an unhandled error. Best-effort and non-throwing by contract — call
 * it inside `waitUntil` and ignore the result.
 *
 * Silent outside production: a local `pnpm dev:api` or a test run must not send
 * mail, and an alert that fires in development is an alert people learn to
 * ignore in production.
 */
export async function alertUnhandledError(
  env: Env,
  err: unknown,
  ctx: AlertContext,
): Promise<void> {
  try {
    if (!isProductionEnv(env)) return;

    const slackWebhook = env.ALERT_SLACK_WEBHOOK_URL;
    const emailTo = env.ALERT_EMAIL_TO;
    if (!slackWebhook && !emailTo) return;

    const detail = describeError(err);
    if (!(await shouldAlert(env, fingerprint(ctx.path, detail)))) return;

    const summary = alertSummary(ctx, detail);
    // One channel failing must not stop the other.
    const results = await Promise.allSettled([
      slackWebhook ? postToSlack(slackWebhook, summary) : Promise.resolve(),
      emailTo ? sendAlertEmail(env, emailTo, summary) : Promise.resolve(),
    ]);
    for (const result of results) {
      if (result.status === "rejected") {
        console.error(
          JSON.stringify({
            msg: "alert_delivery_failed",
            correlationId: ctx.correlationId,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          }),
        );
      }
    }
  } catch (alertErr) {
    // Never let alerting break the request it is reporting on.
    console.error(
      JSON.stringify({
        msg: "alert_failed",
        error: alertErr instanceof Error ? alertErr.message : String(alertErr),
      }),
    );
  }
}
