import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { inventoryScanSchema } from "@skillist/contracts";
import { organizations, registryEntries, skillInventory, skills } from "@skillist/db/schema";
import { scanSkillSecurity } from "@skillist/skill-format";
import { and, desc, eq, getTableColumns, inArray } from "drizzle-orm";
import { logAudit } from "../../lib/audit";
import { requireOrgAccess } from "../../lib/org-access";
import type { AppEnv } from "./shared";

export const inventoryRoutes = new OpenAPIHono<AppEnv>();

const inventoryScanRoute = createRoute({
  method: "post",
  path: "/orgs/{orgId}/inventory/scan",
  tags: ["Inventory"],
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    body: { content: { "application/json": { schema: inventoryScanSchema } } },
  },
  responses: { 200: { description: "Inventory updated" } },
});

inventoryRoutes.openapi(inventoryScanRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const body = c.req.valid("json");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "publisher");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const { resolveGithubToRegistry } = await import("../../lib/github-registry-map");

  const scannedRepos = [...new Set(body.items.map((i) => i.repoFullName))];
  const previous =
    scannedRepos.length > 0
      ? await c.var.db
          .select({
            repoFullName: skillInventory.repoFullName,
            filePath: skillInventory.filePath,
          })
          .from(skillInventory)
          .where(
            and(
              eq(skillInventory.orgId, orgId),
              inArray(skillInventory.repoFullName, scannedRepos),
            ),
          )
      : [];
  const previousKeys = new Set(previous.map((p) => `${p.repoFullName}\0${p.filePath}`));
  const seenKeys = new Set<string>();

  let upserted = 0;
  let created = 0;
  let updated = 0;
  for (const item of body.items) {
    const key = `${item.repoFullName}\0${item.filePath}`;
    seenKeys.add(key);
    const isNew = !previousKeys.has(key);
    if (isNew) created++;
    else updated++;

    const resolved = await resolveGithubToRegistry(c.var.db, {
      repoFullName: item.repoFullName,
      localSlug: item.localSlug,
      registryOrgSlug: item.registryOrgSlug,
      registryRepo: item.registryRepo,
    });
    const registryOrgSlug = resolved?.registryOrgSlug ?? item.registryOrgSlug ?? null;
    const registryRepo = resolved?.registryRepo ?? item.registryRepo ?? null;

    let securityStatus = item.securityStatus ?? null;
    let securityIssues = item.securityIssues ?? null;
    if (item.skillMd && !securityStatus) {
      const scan = scanSkillSecurity(new Map([["SKILL.md", item.skillMd]]));
      securityStatus = scan.status;
      securityIssues = scan.issues;
    }

    await c.var.db
      .insert(skillInventory)
      .values({
        orgId,
        repoFullName: item.repoFullName,
        filePath: item.filePath,
        localSlug: item.localSlug ?? null,
        managed: Boolean(registryOrgSlug && registryRepo),
        registryOrgSlug,
        registryRepo,
        sourceType: item.sourceType ?? null,
        scope: item.scope ?? null,
        marketplace: item.marketplace ?? null,
        pluginName: item.pluginName ?? null,
        isSymlink: item.isSymlink ?? false,
        conformanceStatus: item.conformanceStatus ?? null,
        conformanceIssues: item.conformanceIssues ?? null,
        contentHash: item.contentHash ?? null,
        securityStatus,
        securityIssues,
        scannedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [skillInventory.orgId, skillInventory.repoFullName, skillInventory.filePath],
        set: {
          localSlug: item.localSlug ?? null,
          managed: Boolean(registryOrgSlug && registryRepo),
          registryOrgSlug,
          registryRepo,
          sourceType: item.sourceType ?? null,
          scope: item.scope ?? null,
          marketplace: item.marketplace ?? null,
          pluginName: item.pluginName ?? null,
          isSymlink: item.isSymlink ?? false,
          conformanceStatus: item.conformanceStatus ?? null,
          conformanceIssues: item.conformanceIssues ?? null,
          contentHash: item.contentHash ?? null,
          securityStatus,
          securityIssues,
          scannedAt: new Date(),
        },
      });
    upserted++;
  }

  const removed = previous.filter((p) => !seenKeys.has(`${p.repoFullName}\0${p.filePath}`)).length;

  // Near-duplicate groups by localSlug / contentHash
  const allItems = await c.var.db
    .select({
      localSlug: skillInventory.localSlug,
      contentHash: skillInventory.contentHash,
      filePath: skillInventory.filePath,
      repoFullName: skillInventory.repoFullName,
    })
    .from(skillInventory)
    .where(eq(skillInventory.orgId, orgId));
  const bySlug = new Map<string, number>();
  const byHash = new Map<string, number>();
  for (const row of allItems) {
    if (row.localSlug) bySlug.set(row.localSlug, (bySlug.get(row.localSlug) ?? 0) + 1);
    if (row.contentHash) byHash.set(row.contentHash, (byHash.get(row.contentHash) ?? 0) + 1);
  }
  const duplicateSlugs = [...bySlug.entries()].filter(([, n]) => n > 1).map(([slug]) => slug);
  const duplicateHashes = [...byHash.entries()].filter(([, n]) => n > 1).map(([hash]) => hash);

  await logAudit(c.var.db, {
    orgId,
    actorId: access.actorId,
    actorType: access.actorType,
    action: "inventory.scanned",
    resourceType: "organization",
    resourceId: orgId,
    metadata: { count: upserted, created, updated, removed },
  });

  return c.json(
    {
      upserted,
      diff: { created, updated, removed },
      duplicates: { slugs: duplicateSlugs, contentHashes: duplicateHashes },
    },
    200,
  );
});

const listInventoryRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/inventory",
  tags: ["Inventory"],
  request: { params: z.object({ orgId: z.string().uuid() }) },
  responses: { 200: { description: "Skill inventory" } },
});

inventoryRoutes.openapi(listInventoryRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  // Managed items point at a registry skill via (registryOrgSlug, registryRepo),
  // which is unique in registry_entries — a one-to-one left join surfaces the
  // backing skills.id so the web app can curate them as real skill project items.
  // Rows without a public registry match (or unmanaged) resolve skillId to null.
  const items = await c.var.db
    .select({
      ...getTableColumns(skillInventory),
      skillId: registryEntries.skillId,
    })
    .from(skillInventory)
    .leftJoin(
      registryEntries,
      and(
        eq(registryEntries.orgSlug, skillInventory.registryOrgSlug),
        eq(registryEntries.skillRepo, skillInventory.registryRepo),
      ),
    )
    .where(eq(skillInventory.orgId, orgId))
    .orderBy(desc(skillInventory.scannedAt));

  const bySlug = new Map<string, typeof items>();
  const byHash = new Map<string, typeof items>();
  for (const item of items) {
    if (item.localSlug) {
      const list = bySlug.get(item.localSlug) ?? [];
      list.push(item);
      bySlug.set(item.localSlug, list);
    }
    if (item.contentHash) {
      const list = byHash.get(item.contentHash) ?? [];
      list.push(item);
      byHash.set(item.contentHash, list);
    }
  }

  return c.json(
    {
      items,
      duplicates: {
        slugs: [...bySlug.entries()]
          .filter(([, rows]) => rows.length > 1)
          .map(([slug, rows]) => ({ slug, count: rows.length })),
        contentHashes: [...byHash.entries()]
          .filter(([, rows]) => rows.length > 1)
          .map(([hash, rows]) => ({ hash, count: rows.length })),
      },
    },
    200,
  );
});

const promoteInventoryRoute = createRoute({
  method: "post",
  path: "/orgs/{orgId}/inventory/{itemId}/promote",
  tags: ["Inventory"],
  request: {
    params: z.object({ orgId: z.string().uuid(), itemId: z.string().uuid() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            repo: z
              .string()
              .min(1)
              .max(64)
              .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
              .optional(),
          }),
        },
      },
    },
  },
  responses: { 201: { description: "Skill created from inventory item" } },
});

inventoryRoutes.openapi(promoteInventoryRoute, async (c) => {
  const { orgId, itemId } = c.req.valid("param");
  const body = c.req.valid("json") ?? {};
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "publisher");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [item] = await c.var.db
    .select()
    .from(skillInventory)
    .where(and(eq(skillInventory.id, itemId), eq(skillInventory.orgId, orgId)))
    .limit(1);
  if (!item) return c.json({ error: "Not found" }, 404);

  const repo =
    body.repo ??
    item.localSlug ??
    item.filePath.split("/").filter(Boolean).at(-2) ??
    "imported-skill";

  const [existing] = await c.var.db
    .select({ id: skills.id })
    .from(skills)
    .where(and(eq(skills.orgId, orgId), eq(skills.repo, repo)))
    .limit(1);
  if (existing) {
    return c.json({ error: `Skill ${repo} already exists`, skillId: existing.id }, 409);
  }

  const [skill] = await c.var.db
    .insert(skills)
    .values({
      orgId,
      repo,
      visibility: "private",
      description: `Promoted from inventory ${item.repoFullName}:${item.filePath}`,
    })
    .returning();

  await c.var.db
    .update(skillInventory)
    .set({
      managed: true,
      registryOrgSlug:
        (
          await c.var.db
            .select({ slug: organizations.slug })
            .from(organizations)
            .where(eq(organizations.id, orgId))
            .limit(1)
        )[0]?.slug ?? null,
      registryRepo: repo,
    })
    .where(eq(skillInventory.id, itemId));

  await logAudit(c.var.db, {
    orgId,
    actorId: access.actorId,
    actorType: access.actorType,
    action: "inventory.promoted",
    resourceType: "skill",
    resourceId: skill?.id ?? null,
    metadata: { itemId, repo, from: item.repoFullName },
  });

  return c.json({ skill }, 201);
});
