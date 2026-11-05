import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "@skillist/db";
import { getPlatformProxy } from "wrangler";

const HERE = fileURLToPath(new URL(".", import.meta.url));

/**
 * A D1 client for Node scripts. D1 is a binding, not a connection string, so a
 * script gets one through wrangler: the local database `pnpm dev:api` uses, or
 * production when `local` is false.
 *
 * Call `dispose` when finished or the process won't exit.
 */
export async function openDb({ local }: { local: boolean }) {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: join(HERE, local ? "d1.local.jsonc" : "d1.remote.jsonc"),
    // Shared with `wrangler dev` and `wrangler d1 ... --local` in apps/api.
    persist: { path: join(HERE, "..", "..", "apps", "api", ".wrangler", "state", "v3") },
    remoteBindings: !local,
  });
  return { db: createDb(proxy.env.DB), dispose: proxy.dispose };
}
