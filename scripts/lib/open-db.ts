import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "@skillist/db";
import { getPlatformProxy } from "wrangler";

const HERE = fileURLToPath(new URL(".", import.meta.url));

/**
 * D1 and R2 clients for Node scripts. These are bindings, not connection strings,
 * so a script gets them through wrangler: the local database `pnpm dev:api` uses, or
 * production when `local` is false.
 *
 * Call `dispose` when finished or the process won't exit.
 */
export async function openDb({ local }: { local: boolean }) {
  const proxy = await getPlatformProxy<{ DB: D1Database; SKILLS_R2: R2Bucket }>({
    configPath: join(HERE, local ? "d1.local.jsonc" : "d1.remote.jsonc"),
    // Shared with `wrangler dev` and `wrangler d1 ... --local` in apps/api.
    persist: { path: join(HERE, "..", "..", "apps", "api", ".wrangler", "state", "v3") },
    remoteBindings: !local,
  });
  return { db: createDb(proxy.env.DB), bucket: proxy.env.SKILLS_R2, dispose: proxy.dispose };
}
