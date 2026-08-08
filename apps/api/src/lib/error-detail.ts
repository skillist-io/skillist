/**
 * Flattens an error into a loggable shape, following the `cause` chain.
 *
 * Drizzle wraps every driver failure in a `DrizzleQueryError` whose message is
 * only `Failed query: <sql>\nparams: <...>`. What actually went wrong — a
 * Postgres SQLSTATE, or a connection Hyperdrive dropped mid-flight — is on
 * `.cause`, so logging `err.message` alone turns every production DB failure
 * into a line that names the query but never the fault. Walking the chain is
 * the difference between "a select on skills failed" and "CONNECTION_CLOSED".
 *
 * Deliberately omits the Postgres `detail`/`hint` fields: they echo row values
 * back (an api-key hash, an email), and this lands in Workers Logs.
 */

/** Depth guard — a cause chain is 2-3 deep in practice; anything longer is a cycle. */
const MAX_DEPTH = 5;

/** Workers Logs truncates long lines; keep each level readable. */
const MAX_MESSAGE_LENGTH = 500;

export type ErrorDetail = {
  name?: string;
  message: string;
  /** postgres-js/Postgres error code — an SQLSTATE ("23505") or a driver code ("CONNECTION_CLOSED"). */
  code?: string;
  severity?: string;
  /** Postgres source routine (e.g. "_bt_check_unique") — pinpoints the failing check. */
  routine?: string;
  constraint?: string;
};

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * One level of the chain. Errors cross a Drizzle/driver boundary, so every
 * field is read defensively rather than through a driver-specific type.
 */
function describeOne(err: unknown): ErrorDetail {
  if (typeof err !== "object" || err === null) {
    return { message: String(err).slice(0, MAX_MESSAGE_LENGTH) };
  }
  const source = err as Record<string, unknown>;
  const message = err instanceof Error ? err.message : (readString(source, "message") ?? "");
  return {
    name: err instanceof Error ? err.name : readString(source, "name"),
    message: message.slice(0, MAX_MESSAGE_LENGTH),
    code: readString(source, "code"),
    severity: readString(source, "severity"),
    routine: readString(source, "routine"),
    constraint: readString(source, "constraint_name") ?? readString(source, "constraint"),
  };
}

/**
 * The error and its causes, outermost first. Callers spread this into the JSON
 * they already log; `causes` is omitted when there are none so the common case
 * stays a one-line entry.
 */
export function describeError(err: unknown): ErrorDetail & { causes?: ErrorDetail[] } {
  const top = describeOne(err);
  const causes: ErrorDetail[] = [];
  const seen = new Set<unknown>([err]);

  let current: unknown = err;
  while (causes.length < MAX_DEPTH) {
    if (typeof current !== "object" || current === null) break;
    const next = (current as { cause?: unknown }).cause;
    if (next === undefined || next === null || seen.has(next)) break;
    seen.add(next);
    causes.push(describeOne(next));
    current = next;
  }

  return causes.length > 0 ? { ...top, causes } : top;
}

/**
 * True when the failure came from the database layer rather than from the
 * caller's input.
 *
 * Handlers that end in `catch (err) { return c.json({ error: err.message }, 400) }`
 * are shaped for *validation* failures, but they swallow infrastructure ones
 * too: a dropped Hyperdrive connection comes back to the browser as a 4xx whose
 * body is the raw failing SQL and its bound params. That reads as "your request
 * was bad", never reaches `onError`, and so never gets logged or alerted on.
 * Use this to rethrow those and let the global handler answer 500.
 */
export function isDatabaseError(err: unknown): boolean {
  let current: unknown = err;
  const seen = new Set<unknown>();
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    // Drizzle wraps every driver failure in a DrizzleQueryError. Identified by
    // its `query`/`params` fields rather than its class name, which does not
    // survive the minified production bundle (and which it never sets anyway —
    // `name` stays "Error").
    const candidate = current as { query?: unknown; params?: unknown };
    if (typeof candidate.query === "string" && Array.isArray(candidate.params)) return true;
    // postgres-js errors carry `severity` (raised by the server) or a
    // `CONNECTION_*` code (raised by the client when the socket goes away).
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && code.startsWith("CONNECTION_")) return true;
    if (typeof (current as { severity?: unknown }).severity === "string") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
