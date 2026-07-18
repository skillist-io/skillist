import * as schema from "@skillist/db/schema";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Env } from "../env";

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
