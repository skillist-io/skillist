import * as schema from "@skillist/db/schema";
import { type AnyColumn, type SQL, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "../env";

/**
 * True for a unique-constraint violation.
 *
 * Lets a handler translate a lost race on a unique index into the same 4xx its
 * read-then-write fast path returns, instead of a 500. D1 reports it only in the
 * message, and Drizzle wraps the driver error, so this walks the cause chain.
 */
export function isUniqueViolation(err: unknown): boolean {
  for (let e = err; e instanceof Error; e = e.cause) {
    if (e.message.includes("UNIQUE constraint failed")) return true;
  }
  return false;
}

/** D1 failures that clear on their own, from its documented error list. */
const TRANSIENT_D1_ERRORS = [
  "D1 DB is overloaded",
  "Network connection lost",
  "Replica disconnected from primary",
  "storage caused object to be reset",
  "reset because its code was updated",
];

/**
 * True when a D1 failure says nothing about the request and is worth retrying.
 * D1 retries reads itself but never writes, so these reach callers, and answering
 * 503 rather than 500 tells a client to try again instead of giving up.
 */
export function isTransientD1Error(err: unknown): boolean {
  for (let e = err; e instanceof Error; e = e.cause) {
    if (TRANSIENT_D1_ERRORS.some((text) => (e as Error).message.includes(text))) return true;
  }
  return false;
}

/**
 * The only part of ExecutionContext callers defer work on. Structural so it
 * accepts both the global ExecutionContext and Hono's `c.executionCtx`, whose
 * generic signatures differ between @cloudflare/workers-types versions.
 */
type WaitUntil = { waitUntil(promise: Promise<unknown>): void };

/**
 * `c.executionCtx` throws when Hono has no ExecutionContext (tests, and non-fetch
 * entrypoints). A caller that only wants to defer best-effort work shouldn't have
 * to care, so this yields `undefined` instead of throwing.
 */
export function safeExecutionCtx(c: { executionCtx: WaitUntil }): WaitUntil | undefined {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

/**
 * The D1 client. A binding, not a connection: there is nothing to open, pool or
 * close, so this is cheap to call anywhere.
 */
export function createWorkerDb(env: Env): import("@skillist/auth").WorkerDb {
  return drizzle(env.DB, { schema });
}

/**
 * A client that may read from a replica near the caller, so it can lag the
 * primary. Only for public browse data that tolerates that: never auth,
 * permissions, delivery visibility, or a read that follows a write.
 */
export function createReadDb(env: Env): import("@skillist/auth").WorkerDb {
  // Drizzle only calls prepare/batch, which a session shares with D1Database.
  return drizzle(env.DB.withSession("first-unconstrained") as unknown as D1Database, { schema });
}

export type { WorkerDb } from "@skillist/auth";

/** Parameters one `skill_files` row binds, for {@link chunkRows}. */
export const SKILL_FILE_COLUMNS = 6;

/** D1 allows 100 bound parameters per statement. */
const MAX_BOUND_PARAMS = 100;

/**
 * Split rows so each multi-row INSERT fits the parameter limit. `columns` is how
 * many parameters one row binds; overestimate rather than under.
 */
export function chunkRows<T>(rows: readonly T[], columns: number): T[][] {
  const size = Math.max(1, Math.floor(MAX_BOUND_PARAMS / columns));
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

/**
 * `column IN (...)` for a list of any length. `inArray` binds one parameter per
 * value and fails past D1's limit, so a list sized by user data goes in as a
 * single JSON parameter instead.
 */
export function inList(column: AnyColumn, values: readonly string[]): SQL {
  return sql`${column} IN (SELECT value FROM json_each(${JSON.stringify(values)}))`;
}

/** True when running against the production deployment (api.skillist.dev). */
export function isProductionEnv(env: Env): boolean {
  return /(?:^|\/\/)(?:[^/]*\.)?skillist\.dev(?:[:/]|$)/.test(env.BETTER_AUTH_URL ?? "");
}

let productionBindingsChecked = false;

/**
 * Warn loudly about production config drift. A missing distributed RATE_LIMITER
 * is degraded but functional (in-memory fallback), so it logs rather than
 * throws. Cheap: memoized after the first check.
 */
export function assertProductionBindings(env: Env): void {
  if (productionBindingsChecked) return;
  productionBindingsChecked = true;
  if (!isProductionEnv(env) || env.RATE_LIMITER) return;
  console.error(
    JSON.stringify({
      msg: "missing_binding",
      binding: "RATE_LIMITER",
      impact: "rate limiting degraded to per-isolate in-memory fallback",
    }),
  );
}
