// @ts-nocheck
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { registryQuerySchema } from "@skillist/contracts";
import {
  organizations,
  registryEntries,
  skills,
  subscriptions,
} from "@skillist/db/schema";
import type { Env } from "../env";
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import { resolveUserId } from "../lib/session";

type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext; db: WorkerDb };
};

export const registryRoutes = new OpenAPIHono<AppEnv>();

const listRegistryRoute = createRoute({
  method: "get",
  path: "/registry",
  tags: ["Registry"],
  request: { query: registryQuerySchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(
              z.object({
                orgSlug: z.string(),
                skillSlug: z.string(),
                name: z.string(),
                description: z.string(),
                latestVersion: z.string().nullable(),
                stars: z.number(),
              }),
            ),
            page: z.number(),
            limit: z.number(),
            total: z.number(),
          }),
        },
      },
      description: "Public skill registry",
    },
  },
});

registryRoutes.openapi(listRegistryRoute, async (c) => {
  const { q, page, limit } = c.req.valid("query");
  const offset = (page - 1) * limit;

  const where = q
    ? or(
        ilike(registryEntries.name, `%${q}%`),
        ilike(registryEntries.description, `%${q}%`),
        ilike(registryEntries.skillSlug, `%${q}%`),
      )
    : undefined;

  const items = await c.var.db
    .select()
    .from(registryEntries)
    .where(where)
    .limit(limit)
    .offset(offset);

  const [countRow] = await c.var.db
    .select({ count: sql<number>`count(*)::int` })
    .from(registryEntries)
    .where(where);

  return c.json({
    items,
    page,
    limit,
    total: countRow?.count ?? 0,
  });
});

const getRegistrySkillRoute = createRoute({
  method: "get",
  path: "/registry/{org}/{slug}",
  tags: ["Registry"],
  request: {
    params: z.object({ org: z.string(), slug: z.string() }),
  },
  responses: { 200: { description: "Registry skill detail" } },
});

registryRoutes.openapi(getRegistrySkillRoute, async (c) => {
  const { org, slug } = c.req.valid("param");
  const [entry] = await c.var.db
    .select()
    .from(registryEntries)
    .where(
      and(
        eq(registryEntries.orgSlug, org),
        eq(registryEntries.skillSlug, slug),
      ),
    )
    .limit(1);
  if (!entry) return c.json({ error: "Not found" }, 404);
  return c.json(entry, 200);
});

const subscribeRoute = createRoute({
  method: "post",
  path: "/registry/{org}/{slug}/subscribe",
  tags: ["Registry"],
  request: {
    params: z.object({ org: z.string(), slug: z.string() }),
  },
  responses: { 201: { description: "Subscribed" } },
});

registryRoutes.openapi(subscribeRoute, async (c) => {
  const userId = await resolveUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const { org, slug } = c.req.valid("param");

  const [orgRow] = await c.var.db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, org))
    .limit(1);
  if (!orgRow) return c.json({ error: "Not found" }, 404);

  const [skill] = await c.var.db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgRow.id), eq(skills.slug, slug)))
    .limit(1);
  if (!skill || skill.visibility !== "public") {
    return c.json({ error: "Not found" }, 404);
  }

  await c.var.db
    .insert(subscriptions)
    .values({ userId, skillId: skill.id })
    .onConflictDoNothing();

  return c.json({ ok: true }, 201);
});

const updateVisibilityRoute = createRoute({
  method: "patch",
  path: "/orgs/{orgId}/skills/{slug}/visibility",
  tags: ["Skills"],
  request: {
    params: z.object({ orgId: z.string().uuid(), slug: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            visibility: z.enum(["private", "org", "public"]),
          }),
        },
      },
    },
  },
  responses: { 200: { description: "Visibility updated" } },
});

registryRoutes.openapi(updateVisibilityRoute, async (c) => {
  const userId = await resolveUserId(c);
  const { orgId, slug } = c.req.valid("param");
  const { visibility } = c.req.valid("json");
  const { requireOrgRole } = await import("../lib/org-access");
  const access = await requireOrgRole(c.var.db, orgId, userId, "editor");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [skill] = await c.var.db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgId), eq(skills.slug, slug)))
    .limit(1);
  if (!skill) return c.json({ error: "Not found" }, 404);

  await c.var.db
    .update(skills)
    .set({ visibility, updatedAt: new Date() })
    .where(eq(skills.id, skill.id));

  if (visibility === "public" && skill.latestPublishedVersionId) {
    const [orgRow] = await c.var.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    const { getPublishedMeta } = await import("../lib/publish");
    const meta = orgRow
      ? await getPublishedMeta(c.env.SKILLS_KV, orgRow.slug, slug)
      : null;
    if (meta && orgRow) {
      await c.var.db
        .insert(registryEntries)
        .values({
          skillId: skill.id,
          orgSlug: orgRow.slug,
          skillSlug: slug,
          name: meta.name,
          description: meta.description,
          latestVersion: meta.version,
        })
        .onConflictDoUpdate({
          target: registryEntries.skillId,
          set: {
            name: meta.name,
            description: meta.description,
            latestVersion: meta.version,
            updatedAt: new Date(),
          },
        });
    }
  }

  return c.json({ ok: true }, 200);
});
