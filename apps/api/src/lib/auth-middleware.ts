import { apiKeys } from "@skillist/db/schema";
import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import type { Env } from "../env";
import { closeWorkerDb, createWorkerDb } from "./db";
import { sha256 } from "./r2";
import { resolveSessionUserId } from "./session";

export type AuthContext = {
  userId: string | null;
  apiKeyId: string | null;
  apiKeyOrgId: string | null;
  apiKeyCreatedBy: string | null;
  apiKeyScopes: string[];
};

export const authMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: { auth: AuthContext; db: ReturnType<typeof createWorkerDb> };
}>(async (c, next) => {
  const db = createWorkerDb(c.env);
  c.set("db", db);

  const authHeader = c.req.header("Authorization");
  let userId: string | null = null;
  let apiKeyId: string | null = null;
  let apiKeyOrgId: string | null = null;
  let apiKeyCreatedBy: string | null = null;
  let apiKeyScopes: string[] = [];

  if (authHeader?.startsWith("Bearer sk_")) {
    const key = authHeader.slice(7);
    const keyHash = await sha256(key);
    const [record] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1);
    // A revoked or expired key authenticates as no one — it is ignored here
    // rather than error so a stale key falls back to session auth (or 401 at
    // the route) exactly like an unknown key.
    const isValid =
      record && !record.revokedAt && (!record.expiresAt || record.expiresAt > new Date());
    if (record && isValid) {
      apiKeyId = record.id;
      apiKeyOrgId = record.orgId;
      apiKeyCreatedBy = record.createdBy;
      apiKeyScopes = (record.scopes as string[]) ?? [];
      // `lastUsedAt` is approximate and on the hot auth path: only write when it
      // is stale (>5 min), and fire-and-forget so it never adds a blocking DB
      // round-trip to the request.
      const lastUsed = record.lastUsedAt?.getTime() ?? 0;
      if (Date.now() - lastUsed > 5 * 60_000) {
        const write = db
          .update(apiKeys)
          .set({ lastUsedAt: new Date() })
          .where(eq(apiKeys.id, record.id));
        try {
          c.executionCtx.waitUntil(write.catch(() => {}));
        } catch {
          // No executionCtx (e.g. in tests): fall back to awaiting inline.
          await write.catch(() => {});
        }
      }
    }
  }

  if (!userId) {
    userId = await resolveSessionUserId(db, c.env, c.req.raw.headers);
  }

  c.set("auth", { userId, apiKeyId, apiKeyOrgId, apiKeyCreatedBy, apiKeyScopes });
  try {
    await next();
  } finally {
    // Release the connection once the handler is done. In `finally` so an error
    // response closes it too, and via waitUntil so the close does not delay the
    // response. Without this the socket lingers until the isolate is evicted.
    let ctx: { waitUntil(promise: Promise<unknown>): void } | undefined;
    try {
      ctx = c.executionCtx;
    } catch {
      // No executionCtx (tests): close without deferring.
    }
    closeWorkerDb(db, ctx);
  }
});

export function requireScope(scope: string) {
  return createMiddleware<{
    Variables: { auth: AuthContext };
  }>(async (c, next) => {
    const auth = c.get("auth");
    if (!auth.apiKeyScopes.includes(scope) && !auth.userId) {
      return c.json({ error: "Forbidden" }, 403);
    }
    if (auth.apiKeyId && !auth.apiKeyScopes.includes(scope)) {
      return c.json({ error: "Insufficient scope" }, 403);
    }
    await next();
  });
}
