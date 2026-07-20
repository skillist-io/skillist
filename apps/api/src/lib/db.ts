import * as schema from "@skillist/db/schema";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Env } from "../env";

/**
 * True for a Postgres unique-constraint violation (SQLSTATE 23505).
 *
 * Lets a handler translate a lost race on a unique index into the same 4xx its
 * read-then-write fast path returns, instead of a 500. postgres-js surfaces the
 * driver error with `code` on it; the shape is checked defensively because the
 * error crosses a Drizzle boundary.
 */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}

/**
 * Default DB client — routed through the caching-DISABLED Hyperdrive so reads
 * are always fresh (auth, permissions, writes, read-after-write). Falls back to
 * the single HYPERDRIVE binding when the cache-disabled one isn't configured
 * (local dev / tests), which behaves exactly as before.
 */
export function createWorkerDb(env: Env): import("@skillist/auth").WorkerDb {
  const connectionString =
    env.HYPERDRIVE_CACHE_DISABLED?.connectionString ?? env.HYPERDRIVE.connectionString;
  const client = postgres(connectionString, {
    prepare: false,
    max: 1,
  });
  return drizzle(client, { schema });
}

/**
 * Cached DB client — routed through the caching-enabled HYPERDRIVE binding.
 * Use ONLY for high-volume, staleness-tolerant reads (registry browse/search/
 * facets). Never for auth, permissions, or reads that must reflect a just-
 * committed write, since Hyperdrive does not invalidate its cache on writes.
 */
export function createWorkerDbCached(env: Env): import("@skillist/auth").WorkerDb {
  const client = postgres(env.HYPERDRIVE.connectionString, {
    prepare: false,
    max: 1,
  });
  return drizzle(client, { schema });
}

export type { WorkerDb } from "@skillist/auth";

/** True when running against the production deployment (api.skillist.io). */
function isProductionEnv(env: Env): boolean {
  return /(?:^|\/\/)(?:[^/]*\.)?skillist\.io(?:[:/]|$)/.test(env.BETTER_AUTH_URL ?? "");
}

let cacheDisabledBindingOk = false;

/**
 * Fail-loud guard against production config drift. `createWorkerDb` silently
 * falls back to the caching-enabled Hyperdrive when the cache-disabled binding
 * is absent — in production that means auth/permission/API-key reads can serve
 * up to the Hyperdrive cache TTL stale (a revoked key keeps authenticating).
 * We refuse to serve rather than degrade silently. A missing distributed
 * RATE_LIMITER is degraded-but-functional (in-memory fallback), so it warns
 * loudly instead of throwing. Cheap: memoized after the first OK check.
 */
export function assertProductionBindings(env: Env): void {
  if (cacheDisabledBindingOk) return;
  if (!isProductionEnv(env)) {
    cacheDisabledBindingOk = true;
    return;
  }
  if (!env.RATE_LIMITER) {
    console.error(
      JSON.stringify({
        msg: "missing_binding",
        binding: "RATE_LIMITER",
        impact: "rate limiting degraded to per-isolate in-memory fallback",
      }),
    );
  }
  if (!env.HYPERDRIVE_CACHE_DISABLED) {
    throw new Error(
      "Production is missing the HYPERDRIVE_CACHE_DISABLED binding. Auth, " +
        "permission, and API-key reads would silently serve stale (cached) data " +
        "— refusing to serve. Add the cache-disabled Hyperdrive config to " +
        "wrangler.production.jsonc.",
    );
  }
  cacheDisabledBindingOk = true;
}
