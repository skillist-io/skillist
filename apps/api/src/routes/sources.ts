import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { skillSourceSuggestions, skillSources } from "@skillist/db/schema";
import { desc, eq } from "drizzle-orm";
import type { Env } from "../env";
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import { DEFAULT_ROOTS } from "../lib/github-sync/discover";

type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext; db: WorkerDb };
};

export const sourcesRoutes = new OpenAPIHono<AppEnv>();

const jsonError = (description: string) => ({
  content: { "application/json": { schema: z.object({ error: z.any() }) } },
  description,
});

function requireAdmin(c: { env: Env; get: (k: "auth") => AuthContext }) {
  const auth = c.get("auth");
  if (!auth.userId) return { ok: false as const, status: 401 as const, error: "Unauthorized" };
  const allow = (c.env.SKILLIST_ADMIN_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allow.length === 0 || !allow.includes(auth.userId)) {
    return { ok: false as const, status: 403 as const, error: "Admin only" };
  }
  return { ok: true as const, userId: auth.userId };
}

const listSourcesRoute = createRoute({
  method: "get",
  path: "/admin/sources",
  tags: ["Admin"],
  responses: {
    200: {
      description: "Curated skill sources",
      content: { "application/json": { schema: z.object({ items: z.array(z.unknown()) }) } },
    },
    401: jsonError("Unauthorized"),
    403: jsonError("Admin only"),
  },
});

sourcesRoutes.openapi(listSourcesRoute, async (c) => {
  const admin = requireAdmin(c);
  if (!admin.ok) return c.json({ error: admin.error }, admin.status);
  const items = await c.var.db.select().from(skillSources).orderBy(desc(skillSources.updatedAt));
  return c.json({ items }, 200);
});

const listSuggestionsRoute = createRoute({
  method: "get",
  path: "/admin/source-suggestions",
  tags: ["Admin"],
  request: {
    query: z.object({
      status: z.enum(["pending", "approved", "rejected", "all"]).optional().default("pending"),
    }),
  },
  responses: {
    200: {
      description: "Suggested GitHub skill repos",
      content: { "application/json": { schema: z.object({ items: z.array(z.unknown()) }) } },
    },
    401: jsonError("Unauthorized"),
    403: jsonError("Admin only"),
  },
});

sourcesRoutes.openapi(listSuggestionsRoute, async (c) => {
  const admin = requireAdmin(c);
  if (!admin.ok) return c.json({ error: admin.error }, admin.status);
  const { status } = c.req.valid("query");
  const where = status === "all" ? undefined : eq(skillSourceSuggestions.status, status);
  const items = await c.var.db
    .select()
    .from(skillSourceSuggestions)
    .where(where)
    .orderBy(desc(skillSourceSuggestions.matchScore));
  return c.json({ items }, 200);
});

const approveSuggestionRoute = createRoute({
  method: "post",
  path: "/admin/source-suggestions/{id}/approve",
  tags: ["Admin"],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              discoveryRoots: z.array(z.string()).optional(),
              defaultBranch: z.string().optional(),
            })
            .optional(),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Suggestion approved and sync enqueued",
      content: {
        "application/json": {
          schema: z.object({ sourceId: z.string().uuid(), status: z.string() }),
        },
      },
    },
    401: jsonError("Unauthorized"),
    403: jsonError("Admin only"),
    404: jsonError("Not found"),
  },
});

sourcesRoutes.openapi(approveSuggestionRoute, async (c) => {
  const admin = requireAdmin(c);
  if (!admin.ok) return c.json({ error: admin.error }, admin.status);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json") ?? {};
  const db = c.var.db;

  const [suggestion] = await db
    .select()
    .from(skillSourceSuggestions)
    .where(eq(skillSourceSuggestions.id, id))
    .limit(1);
  if (!suggestion) return c.json({ error: "Not found" }, 404);

  const [source] = await db
    .insert(skillSources)
    .values({
      githubOwner: suggestion.githubOwner,
      githubRepo: suggestion.githubRepo,
      defaultBranch: body.defaultBranch ?? "main",
      discoveryRoots: body.discoveryRoots ?? DEFAULT_ROOTS,
      trustTier: "official_mirror",
      syncEnabled: true,
      license: suggestion.license,
    })
    .onConflictDoUpdate({
      target: [skillSources.githubOwner, skillSources.githubRepo],
      set: {
        syncEnabled: true,
        license: suggestion.license,
        updatedAt: new Date(),
      },
    })
    .returning();

  await db
    .update(skillSourceSuggestions)
    .set({
      status: "approved",
      reviewedAt: new Date(),
      reviewedBy: admin.userId,
      updatedAt: new Date(),
    })
    .where(eq(skillSourceSuggestions.id, id));

  await c.env.SYNC_QUEUE.send({ type: "sync_source", sourceId: source!.id });
  return c.json({ sourceId: source!.id, status: "approved" }, 200);
});

const rejectSuggestionRoute = createRoute({
  method: "post",
  path: "/admin/source-suggestions/{id}/reject",
  tags: ["Admin"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      description: "Suggestion rejected",
      content: { "application/json": { schema: z.object({ status: z.string() }) } },
    },
    401: jsonError("Unauthorized"),
    403: jsonError("Admin only"),
  },
});

sourcesRoutes.openapi(rejectSuggestionRoute, async (c) => {
  const admin = requireAdmin(c);
  if (!admin.ok) return c.json({ error: admin.error }, admin.status);
  const { id } = c.req.valid("param");
  await c.var.db
    .update(skillSourceSuggestions)
    .set({
      status: "rejected",
      reviewedAt: new Date(),
      reviewedBy: admin.userId,
      updatedAt: new Date(),
    })
    .where(eq(skillSourceSuggestions.id, id));
  return c.json({ status: "rejected" }, 200);
});

const syncSourceRoute = createRoute({
  method: "post",
  path: "/admin/sources/{id}/sync",
  tags: ["Admin"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    202: {
      description: "Sync enqueued",
      content: {
        "application/json": {
          schema: z.object({ sourceId: z.string().uuid(), status: z.string() }),
        },
      },
    },
    401: jsonError("Unauthorized"),
    403: jsonError("Admin only"),
    404: jsonError("Not found"),
  },
});

sourcesRoutes.openapi(syncSourceRoute, async (c) => {
  const admin = requireAdmin(c);
  if (!admin.ok) return c.json({ error: admin.error }, admin.status);
  const { id } = c.req.valid("param");
  const [source] = await c.var.db
    .select({ id: skillSources.id })
    .from(skillSources)
    .where(eq(skillSources.id, id))
    .limit(1);
  if (!source) return c.json({ error: "Not found" }, 404);
  await c.env.SYNC_QUEUE.send({ type: "sync_source", sourceId: source.id });
  return c.json({ sourceId: source.id, status: "queued" }, 202);
});

const syncAllRoute = createRoute({
  method: "post",
  path: "/admin/sources/sync-all",
  tags: ["Admin"],
  responses: {
    202: {
      description: "Full sync enqueued",
      content: { "application/json": { schema: z.object({ status: z.string() }) } },
    },
    401: jsonError("Unauthorized"),
    403: jsonError("Admin only"),
  },
});

sourcesRoutes.openapi(syncAllRoute, async (c) => {
  const admin = requireAdmin(c);
  if (!admin.ok) return c.json({ error: admin.error }, admin.status);
  await c.env.SYNC_QUEUE.send({ type: "sync_all" });
  return c.json({ status: "queued" }, 202);
});
