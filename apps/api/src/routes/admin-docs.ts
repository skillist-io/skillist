import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Env } from "../env";
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import { DOC_KIND, DOCS_EMBEDDING_MODEL } from "../lib/docs-rag";

type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext; db: WorkerDb };
};

export const adminDocsRoutes = new OpenAPIHono<AppEnv>();

/**
 * Platform-admin gate for the docs reindex. Unlike org resources, docs are
 * global, so access is keyed on the SKILLIST_ADMIN_USER_IDS allow-list (the same
 * list `routes/sources.ts` uses). Accepts either an admin **session** or an
 * admin-created **API key** (`sk_...`) — the latter is what lets the offline
 * `embed:docs` script authenticate from a shell without a browser cookie, in
 * line with the repo's "API keys for CLI/programmatic writes" convention.
 *
 * An API key must additionally carry the explicit `admin:docs` scope. Falling
 * back to `apiKeyCreatedBy` alone meant ANY key an admin had ever minted — a
 * `skills:read` key handed to CI, say — silently conferred platform-admin.
 * Scope is checked before the allow-list so a non-admin's key cannot probe
 * membership of that list.
 */
export function requireDocsAdmin(env: Env, auth: AuthContext) {
  const allow = (env.SKILLIST_ADMIN_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allow.length === 0) return { ok: false as const, status: 403 as const, error: "Admin only" };
  if (auth.apiKeyId && !auth.apiKeyScopes.includes("admin:docs")) {
    return { ok: false as const, status: 403 as const, error: "Insufficient scope" };
  }
  // A session user OR the creator of the presented API key must be an admin.
  const actor = auth.userId ?? auth.apiKeyCreatedBy;
  if (!actor) return { ok: false as const, status: 401 as const, error: "Unauthorized" };
  if (!allow.includes(actor))
    return { ok: false as const, status: 403 as const, error: "Admin only" };
  return { ok: true as const, actor };
}

const chunkSchema = z.object({
  id: z.string().min(1),
  page: z.string(),
  heading: z.string(),
  text: z.string().min(1),
});

const reindexRoute = createRoute({
  method: "post",
  path: "/admin/reindex-docs",
  tags: ["Admin"],
  summary: "Embed and upsert docs passages into the Vectorize index (search_docs source)",
  request: {
    body: {
      content: {
        // The caller (the `embed:docs` script) does the filesystem walk +
        // heading-chunking; the Worker only embeds + upserts, so no Workers-AI
        // API token is needed — it uses the `env.AI` binding.
        "application/json": {
          schema: z.object({ chunks: z.array(chunkSchema).min(1).max(100) }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Passages embedded and upserted (deterministic ids → idempotent)",
      content: {
        "application/json": {
          schema: z.object({ upserted: z.number(), skipped: z.number() }),
        },
      },
    },
    401: { description: "Unauthorized" },
    403: { description: "Admin only" },
  },
});

adminDocsRoutes.openapi(reindexRoute, async (c) => {
  const gate = requireDocsAdmin(c.env, c.var.auth);
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);

  const { chunks } = c.req.valid("json");

  // One batched embed call for the whole request (the script caps batches at
  // <=100). BGE returns one 768-dim vector per input text, in order.
  const embed = (await c.env.AI.run(DOCS_EMBEDDING_MODEL, {
    text: chunks.map((ch) => ch.text),
  })) as { data?: number[][] };
  const vectors = embed.data ?? [];

  const upserts: {
    id: string;
    values: number[];
    metadata: { kind: string; page: string; heading: string; text: string };
  }[] = [];
  chunks.forEach((ch, i) => {
    const values = vectors[i];
    // Skip a degenerate embedding rather than store a zero/empty vector.
    if (!values || values.length === 0) return;
    upserts.push({
      id: ch.id,
      values,
      metadata: { kind: DOC_KIND, page: ch.page, heading: ch.heading, text: ch.text },
    });
  });

  if (upserts.length > 0) await c.env.VECTORIZE.upsert(upserts);
  return c.json({ upserted: upserts.length, skipped: chunks.length - upserts.length }, 200);
});
