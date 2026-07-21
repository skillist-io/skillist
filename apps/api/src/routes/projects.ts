import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  addProjectItemSchema,
  addProjectMemberSchema,
  createProjectSchema,
  updateProjectItemSchema,
  updateProjectMemberSchema,
  updateProjectSchema,
} from "@skillist/contracts";
import {
  organizations,
  orgMembers,
  projectItems,
  projectMembers,
  projects,
  registryEntries,
  skills,
  users,
} from "@skillist/db/schema";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Env } from "../env";
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import { errorResponses, okSchema } from "../lib/openapi";
import { requireOrgAccess } from "../lib/org-access";
import { canWriteProject, requireProjectAccess } from "../lib/project-access";

type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext; db: WorkerDb };
};

export const projectRoutes = new OpenAPIHono<AppEnv>();

const orgParam = z.object({ orgId: z.string().uuid() });
const projectParam = z.object({ orgId: z.string().uuid(), projectId: z.string().uuid() });
const itemParam = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  itemId: z.string().uuid(),
});
const memberParam = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  userId: z.string().min(1),
});

// Postgres unique-violation SQLSTATE. The partial-unique indexes on
// (project_id, skill_id) and (project_id, external_url) surface as 23505.
function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (code === "23505") return true;
  const cause = (err as { cause?: unknown }).cause;
  if (cause && cause !== err) return isUniqueViolation(cause);
  return false;
}

/** A row of `projects`; timestamps serialize to ISO strings. */
const projectRowSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  visibility: z.enum(["private", "shared"]),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** A row of `project_items`. */
const projectItemRowSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  kind: z.enum(["skill", "external"]),
  skillId: z.string().uuid().nullable(),
  externalUrl: z.string().nullable(),
  externalName: z.string().nullable(),
  path: z.string(),
  position: z.number(),
  label: z.string().nullable(),
  note: z.string().nullable(),
  addedBy: z.string().nullable(),
  createdAt: z.string(),
});

// ---------------------------------------------------------------------------
// 1. List org projects
// ---------------------------------------------------------------------------
const listProjectsRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/projects",
  tags: ["Projects"],
  operationId: "listProjects",
  summary: "List projects visible to the caller in an organization",
  request: { params: orgParam },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.array(
            z.object({
              id: z.string().uuid(),
              slug: z.string(),
              name: z.string(),
              description: z.string().nullable(),
              visibility: z.enum(["private", "shared"]),
              role: z.enum(["viewer", "editor", "admin"]).nullable(),
              canWrite: z.boolean(),
              createdAt: z.string(),
              itemCount: z.number(),
            }),
          ),
        },
      },
      description: "List org projects",
    },
    ...errorResponses({ validates: false, notFound: false }),
  },
});

projectRoutes.openapi(listProjectsRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer", {
    apiKeyScope: "skills:read",
  });
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const isOrgAdmin = access.role === "owner";
  const actorId = access.actorType === "user" ? access.actorId : null;

  // Non-owners see only projects they can READ: shared projects, or ones where
  // they hold a membership row. Org owners see every project in the org. API
  // keys (no actorId) see only shared projects.
  const visibilityFilter = isOrgAdmin
    ? eq(projects.orgId, orgId)
    : and(
        eq(projects.orgId, orgId),
        actorId
          ? or(
              eq(projects.visibility, "shared"),
              inArray(
                projects.id,
                c.var.db
                  .select({ projectId: projectMembers.projectId })
                  .from(projectMembers)
                  .where(eq(projectMembers.userId, actorId)),
              ),
            )
          : eq(projects.visibility, "shared"),
      );

  // Single grouped query: LEFT JOIN + COUNT so empty projects report itemCount 0
  // rather than issuing one count query per project. The actor's own membership
  // role is pulled in via a LEFT JOIN scoped to this actor.
  const rows = await c.var.db
    .select({
      id: projects.id,
      slug: projects.slug,
      name: projects.name,
      description: projects.description,
      visibility: projects.visibility,
      role: projectMembers.role,
      createdAt: projects.createdAt,
      itemCount: sql<number>`count(${projectItems.id})::int`,
    })
    .from(projects)
    .leftJoin(projectItems, eq(projectItems.projectId, projects.id))
    .leftJoin(
      projectMembers,
      and(
        eq(projectMembers.projectId, projects.id),
        actorId ? eq(projectMembers.userId, actorId) : sql`false`,
      ),
    )
    .where(visibilityFilter)
    .groupBy(projects.id, projectMembers.role)
    .orderBy(desc(projects.createdAt));

  return c.json(
    rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      description: r.description,
      visibility: r.visibility,
      role: r.role ?? null,
      canWrite: canWriteProject(access.role, r.role ?? null, r.visibility),
      createdAt: r.createdAt.toISOString(),
      itemCount: r.itemCount,
    })),
    200,
  );
});

// ---------------------------------------------------------------------------
// 2. Create project
// ---------------------------------------------------------------------------
const createProjectRoute = createRoute({
  method: "post",
  path: "/orgs/{orgId}/projects",
  tags: ["Projects"],
  operationId: "createProject",
  summary: "Create a project",
  request: {
    params: orgParam,
    body: { content: { "application/json": { schema: createProjectSchema } } },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: z.object({
            id: z.string().uuid(),
            slug: z.string(),
            name: z.string(),
            visibility: z.enum(["private", "shared"]),
          }),
        },
      },
      description: "Project created",
    },
    ...errorResponses({ notFound: false, conflict: true }),
  },
});

projectRoutes.openapi(createProjectRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  // Any org member may create a project (they become its admin).
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer", {
    apiKeyScope: "skills:write",
  });
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);
  const body = c.req.valid("json");

  try {
    const [project] = await c.var.db
      .insert(projects)
      .values({
        orgId,
        slug: body.slug,
        name: body.name,
        description: body.description ?? null,
        visibility: body.visibility ?? "private",
        createdBy: access.actorId,
      })
      .returning({
        id: projects.id,
        slug: projects.slug,
        name: projects.name,
        visibility: projects.visibility,
      });
    if (!project) return c.json({ error: "Failed to create project" }, 500);

    // The creator becomes the project's admin. API-key actors have no user id to
    // attach membership to, so they rely on org standing instead. Sequential
    // insert (mirrors skills.ts multi-insert style); the unique index keeps it
    // idempotent-ish if retried.
    if (access.actorType === "user" && access.actorId) {
      await c.var.db.insert(projectMembers).values({
        projectId: project.id,
        userId: access.actorId,
        role: "admin",
        addedBy: access.actorId,
      });
    }

    return c.json(project, 201);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return c.json({ error: `A project with slug "${body.slug}" already exists` }, 409);
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// 3. Get project with resolved items
// ---------------------------------------------------------------------------
const getProjectRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/projects/{projectId}",
  tags: ["Projects"],
  operationId: "getProject",
  summary: "Get a project and its resolved items",
  request: { params: projectParam },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            id: z.string().uuid(),
            slug: z.string(),
            name: z.string(),
            description: z.string().nullable(),
            visibility: z.enum(["private", "shared"]),
            role: z.enum(["viewer", "editor", "admin"]).nullable(),
            canWrite: z.boolean(),
            canManage: z.boolean(),
            // Two shapes, discriminated by `kind`. The skill branch's fields
            // come from LEFT JOINs, so they are nullable even for a skill item
            // whose skill row was since deleted.
            items: z.array(
              z.union([
                z.object({
                  id: z.string().uuid(),
                  kind: z.literal("skill"),
                  path: z.string(),
                  position: z.number(),
                  label: z.string().nullable(),
                  note: z.string().nullable(),
                  skillId: z.string().uuid().nullable(),
                  orgSlug: z.string().nullable(),
                  repo: z.string().nullable(),
                  visibility: z.string().nullable(),
                  description: z.string().nullable(),
                }),
                z.object({
                  id: z.string().uuid(),
                  kind: z.literal("external"),
                  path: z.string(),
                  position: z.number(),
                  label: z.string().nullable(),
                  note: z.string().nullable(),
                  externalUrl: z.string().nullable(),
                  externalName: z.string().nullable(),
                }),
              ]),
            ),
          }),
        },
      },
      description: "Project with resolved items",
    },
    ...errorResponses(),
  },
});

projectRoutes.openapi(getProjectRoute, async (c) => {
  const { orgId, projectId } = c.req.valid("param");
  const access = await requireProjectAccess(c.var.db, orgId, projectId, c.var.auth, "read");
  if (!access.ok) {
    if (access.status === 404) return c.json({ error: "Project not found" }, 404);
    return c.json({ error: access.status === 401 ? "Unauthorized" : "Forbidden" }, access.status);
  }
  const project = access.project;

  // Resolve each item's display metadata in a single query: skill items join
  // `skills` (for repo/visibility/description) + `organizations` (owning org
  // slug, which may differ from this org for public skills) + `registryEntries`
  // (published registry description, preferred when present).
  const rows = await c.var.db
    .select({
      id: projectItems.id,
      kind: projectItems.kind,
      path: projectItems.path,
      position: projectItems.position,
      label: projectItems.label,
      note: projectItems.note,
      externalUrl: projectItems.externalUrl,
      externalName: projectItems.externalName,
      skillId: skills.id,
      orgSlug: organizations.slug,
      repo: skills.repo,
      visibility: skills.visibility,
      skillDescription: skills.description,
      registryDescription: registryEntries.description,
    })
    .from(projectItems)
    .leftJoin(skills, eq(projectItems.skillId, skills.id))
    .leftJoin(organizations, eq(skills.orgId, organizations.id))
    .leftJoin(registryEntries, eq(registryEntries.skillId, skills.id))
    .where(eq(projectItems.projectId, projectId))
    .orderBy(asc(projectItems.path), asc(projectItems.position));

  const items = rows.map((r) => {
    const base = {
      id: r.id,
      kind: r.kind,
      path: r.path,
      position: r.position,
      label: r.label,
      note: r.note,
    };
    if (r.kind === "skill") {
      return {
        ...base,
        skillId: r.skillId,
        orgSlug: r.orgSlug,
        repo: r.repo,
        visibility: r.visibility,
        description: r.registryDescription ?? r.skillDescription,
      };
    }
    return {
      ...base,
      externalUrl: r.externalUrl,
      externalName: r.externalName,
    };
  });

  return c.json(
    {
      id: project.id,
      slug: project.slug,
      name: project.name,
      description: project.description,
      visibility: project.visibility,
      role: access.projectRole,
      canWrite: canWriteProject(access.orgRole, access.projectRole, project.visibility),
      canManage: access.orgRole === "owner" || access.projectRole === "admin",
      items,
    },
    200,
  );
});

// ---------------------------------------------------------------------------
// 4. Update project (rename / describe)
// ---------------------------------------------------------------------------
const updateProjectRoute = createRoute({
  method: "patch",
  path: "/orgs/{orgId}/projects/{projectId}",
  tags: ["Projects"],
  operationId: "updateProject",
  summary: "Rename, describe, or change the visibility of a project",
  request: {
    params: projectParam,
    body: { content: { "application/json": { schema: updateProjectSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: projectRowSchema } },
      description: "Project updated",
    },
    ...errorResponses(),
  },
});

projectRoutes.openapi(updateProjectRoute, async (c) => {
  const { orgId, projectId } = c.req.valid("param");
  const body = c.req.valid("json");
  // Changing visibility is a governance action → require "manage"; plain
  // rename/describe only needs "write".
  const capability = body.visibility !== undefined ? "manage" : "write";
  const access = await requireProjectAccess(c.var.db, orgId, projectId, c.var.auth, capability);
  if (!access.ok) {
    if (access.status === 404) return c.json({ error: "Project not found" }, 404);
    return c.json({ error: access.status === 401 ? "Unauthorized" : "Forbidden" }, access.status);
  }

  const [updated] = await c.var.db
    .update(projects)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
    .returning();
  if (!updated) return c.json({ error: "Failed to update project" }, 500);

  return c.json(updated, 200);
});

// ---------------------------------------------------------------------------
// 5. Delete project (cascade removes items)
// ---------------------------------------------------------------------------
const deleteProjectRoute = createRoute({
  method: "delete",
  path: "/orgs/{orgId}/projects/{projectId}",
  tags: ["Projects"],
  operationId: "deleteProject",
  summary: "Delete a project and its items",
  request: { params: projectParam },
  responses: {
    200: {
      content: { "application/json": { schema: okSchema } },
      description: "Project deleted",
    },
    ...errorResponses(),
  },
});

projectRoutes.openapi(deleteProjectRoute, async (c) => {
  const { orgId, projectId } = c.req.valid("param");
  const access = await requireProjectAccess(c.var.db, orgId, projectId, c.var.auth, "manage");
  if (!access.ok) {
    if (access.status === 404) return c.json({ error: "Project not found" }, 404);
    return c.json({ error: access.status === 401 ? "Unauthorized" : "Forbidden" }, access.status);
  }

  await c.var.db.delete(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)));

  return c.json({ ok: true }, 200);
});

// ---------------------------------------------------------------------------
// 6. Add item to project
// ---------------------------------------------------------------------------
const addItemRoute = createRoute({
  method: "post",
  path: "/orgs/{orgId}/projects/{projectId}/items",
  tags: ["Projects"],
  operationId: "addProjectItem",
  summary: "Add a skill or external link to a project",
  request: {
    params: projectParam,
    body: { content: { "application/json": { schema: addProjectItemSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: z.object({ id: z.string().uuid() }) } },
      description: "Item added",
    },
    ...errorResponses({ conflict: true }),
  },
});

projectRoutes.openapi(addItemRoute, async (c) => {
  const { orgId, projectId } = c.req.valid("param");
  const access = await requireProjectAccess(c.var.db, orgId, projectId, c.var.auth, "write");
  if (!access.ok) {
    if (access.status === 404) return c.json({ error: "Project not found" }, 404);
    return c.json({ error: access.status === 401 ? "Unauthorized" : "Forbidden" }, access.status);
  }
  const body = c.req.valid("json");

  if (body.kind === "skill") {
    // biome-ignore lint/style/noNonNullAssertion: schema refine guarantees skillId for kind "skill".
    const skillId = body.skillId!;
    const [skill] = await c.var.db
      .select({ id: skills.id, orgId: skills.orgId, visibility: skills.visibility })
      .from(skills)
      .where(eq(skills.id, skillId))
      .limit(1);
    if (!skill) return c.json({ error: "Skill not found" }, 404);
    // A skill is curatable only if it belongs to this org or is public — this
    // stops a member from smuggling another org's private skill into a project.
    if (skill.orgId !== orgId && skill.visibility !== "public") {
      return c.json({ error: "Skill not accessible to this org" }, 403);
    }
  }

  try {
    const [item] = await c.var.db
      .insert(projectItems)
      .values({
        projectId,
        kind: body.kind,
        skillId: body.kind === "skill" ? body.skillId : null,
        externalUrl: body.kind === "external" ? body.externalUrl : null,
        externalName: body.kind === "external" ? (body.externalName ?? null) : null,
        path: body.path ?? "",
        label: body.label ?? null,
        note: body.note ?? null,
        addedBy: access.actorId,
      })
      .returning({ id: projectItems.id });
    if (!item) return c.json({ error: "Failed to add item" }, 500);
    return c.json({ id: item.id }, 201);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return c.json({ error: "This item is already in the project" }, 409);
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// 7. Update item (move / relabel)
// ---------------------------------------------------------------------------
const updateItemRoute = createRoute({
  method: "patch",
  path: "/orgs/{orgId}/projects/{projectId}/items/{itemId}",
  tags: ["Projects"],
  operationId: "updateProjectItem",
  summary: "Move or relabel a project item",
  request: {
    params: itemParam,
    body: { content: { "application/json": { schema: updateProjectItemSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: projectItemRowSchema } },
      description: "Item updated",
    },
    ...errorResponses(),
  },
});

projectRoutes.openapi(updateItemRoute, async (c) => {
  const { orgId, projectId, itemId } = c.req.valid("param");
  const access = await requireProjectAccess(c.var.db, orgId, projectId, c.var.auth, "write");
  if (!access.ok) {
    if (access.status === 404) return c.json({ error: "Project not found" }, 404);
    return c.json({ error: access.status === 401 ? "Unauthorized" : "Forbidden" }, access.status);
  }
  const body = c.req.valid("json");

  // Verify item ∈ project ∈ org in one join before mutating.
  const [existing] = await c.var.db
    .select({ id: projectItems.id })
    .from(projectItems)
    .innerJoin(projects, eq(projectItems.projectId, projects.id))
    .where(
      and(
        eq(projectItems.id, itemId),
        eq(projectItems.projectId, projectId),
        eq(projects.orgId, orgId),
      ),
    )
    .limit(1);
  if (!existing) return c.json({ error: "Item not found" }, 404);

  const [updated] = await c.var.db
    .update(projectItems)
    .set({
      ...(body.path !== undefined ? { path: body.path } : {}),
      ...(body.position !== undefined ? { position: body.position } : {}),
      ...(body.label !== undefined ? { label: body.label } : {}),
    })
    .where(eq(projectItems.id, itemId))
    .returning();
  if (!updated) return c.json({ error: "Failed to update item" }, 500);

  return c.json(updated, 200);
});

// ---------------------------------------------------------------------------
// 8. Remove item
// ---------------------------------------------------------------------------
const deleteItemRoute = createRoute({
  method: "delete",
  path: "/orgs/{orgId}/projects/{projectId}/items/{itemId}",
  tags: ["Projects"],
  operationId: "removeProjectItem",
  summary: "Remove an item from a project",
  request: { params: itemParam },
  responses: {
    200: {
      content: { "application/json": { schema: okSchema } },
      description: "Item removed",
    },
    ...errorResponses(),
  },
});

projectRoutes.openapi(deleteItemRoute, async (c) => {
  const { orgId, projectId, itemId } = c.req.valid("param");
  const access = await requireProjectAccess(c.var.db, orgId, projectId, c.var.auth, "write");
  if (!access.ok) {
    if (access.status === 404) return c.json({ error: "Project not found" }, 404);
    return c.json({ error: access.status === 401 ? "Unauthorized" : "Forbidden" }, access.status);
  }

  // Confirm ownership chain before deleting so a valid itemId from another
  // org/project can't be removed.
  const [existing] = await c.var.db
    .select({ id: projectItems.id })
    .from(projectItems)
    .innerJoin(projects, eq(projectItems.projectId, projects.id))
    .where(
      and(
        eq(projectItems.id, itemId),
        eq(projectItems.projectId, projectId),
        eq(projects.orgId, orgId),
      ),
    )
    .limit(1);
  if (!existing) return c.json({ error: "Item not found" }, 404);

  await c.var.db.delete(projectItems).where(eq(projectItems.id, itemId));
  return c.json({ ok: true }, 200);
});

// ---------------------------------------------------------------------------
// 9. List project members
// ---------------------------------------------------------------------------
const listMembersRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/projects/{projectId}/members",
  tags: ["Projects"],
  operationId: "listProjectMembers",
  summary: "List a project's members",
  request: { params: projectParam },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.array(
            z.object({
              userId: z.string(),
              name: z.string().nullable(),
              email: z.string().nullable(),
              role: z.enum(["viewer", "editor", "admin"]),
              addedBy: z.string().nullable(),
              createdAt: z.string(),
            }),
          ),
        },
      },
      description: "Project members",
    },
    ...errorResponses(),
  },
});

projectRoutes.openapi(listMembersRoute, async (c) => {
  const { orgId, projectId } = c.req.valid("param");
  const access = await requireProjectAccess(c.var.db, orgId, projectId, c.var.auth, "read");
  if (!access.ok) {
    if (access.status === 404) return c.json({ error: "Project not found" }, 404);
    return c.json({ error: access.status === 401 ? "Unauthorized" : "Forbidden" }, access.status);
  }

  const rows = await c.var.db
    .select({
      userId: projectMembers.userId,
      name: users.name,
      email: users.email,
      role: projectMembers.role,
      addedBy: projectMembers.addedBy,
      createdAt: projectMembers.createdAt,
    })
    .from(projectMembers)
    .leftJoin(users, eq(projectMembers.userId, users.id))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(asc(projectMembers.createdAt));

  return c.json(
    rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    200,
  );
});

// ---------------------------------------------------------------------------
// 10. Add project member
// ---------------------------------------------------------------------------
const addMemberRoute = createRoute({
  method: "post",
  path: "/orgs/{orgId}/projects/{projectId}/members",
  tags: ["Projects"],
  operationId: "addProjectMember",
  summary: "Add an org member to a project",
  request: {
    params: projectParam,
    body: { content: { "application/json": { schema: addProjectMemberSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
      description: "Member added",
    },
    ...errorResponses({ conflict: true }),
  },
});

projectRoutes.openapi(addMemberRoute, async (c) => {
  const { orgId, projectId } = c.req.valid("param");
  const access = await requireProjectAccess(c.var.db, orgId, projectId, c.var.auth, "manage");
  if (!access.ok) {
    if (access.status === 404) return c.json({ error: "Project not found" }, 404);
    return c.json({ error: access.status === 401 ? "Unauthorized" : "Forbidden" }, access.status);
  }
  const body = c.req.valid("json");

  // Only existing org members can be added to a project — this prevents adding
  // arbitrary users who have no standing in the org.
  const [orgMember] = await c.var.db
    .select({ userId: orgMembers.userId })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, body.userId)))
    .limit(1);
  if (!orgMember) return c.json({ error: "User is not a member of this org" }, 400);

  try {
    await c.var.db.insert(projectMembers).values({
      projectId,
      userId: body.userId,
      role: body.role ?? "viewer",
      addedBy: access.actorId,
    });
    return c.json({ ok: true }, 201);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return c.json({ error: "User is already a project member" }, 409);
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// 11. Update project member role
// ---------------------------------------------------------------------------
const updateMemberRoute = createRoute({
  method: "patch",
  path: "/orgs/{orgId}/projects/{projectId}/members/{userId}",
  tags: ["Projects"],
  operationId: "updateProjectMember",
  summary: "Change a project member's role",
  request: {
    params: memberParam,
    body: { content: { "application/json": { schema: updateProjectMemberSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: okSchema } },
      description: "Member updated",
    },
    ...errorResponses({ conflict: true }),
  },
});

projectRoutes.openapi(updateMemberRoute, async (c) => {
  const { orgId, projectId, userId } = c.req.valid("param");
  const access = await requireProjectAccess(c.var.db, orgId, projectId, c.var.auth, "manage");
  if (!access.ok) {
    if (access.status === 404) return c.json({ error: "Project not found" }, 404);
    return c.json({ error: access.status === 401 ? "Unauthorized" : "Forbidden" }, access.status);
  }
  const body = c.req.valid("json");

  const [existing] = await c.var.db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  if (!existing) return c.json({ error: "Member not found" }, 404);

  // Guard the last admin: if this member is currently the sole admin and the new
  // role is not admin, refuse — a project must always retain an admin.
  if (existing.role === "admin" && body.role !== "admin") {
    const [row] = await c.var.db
      .select({ adminCount: sql<number>`count(*)::int` })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.role, "admin")));
    if ((row?.adminCount ?? 0) <= 1) {
      return c.json({ error: "Cannot demote the last admin of a project" }, 409);
    }
  }

  const [updated] = await c.var.db
    .update(projectMembers)
    .set({ role: body.role })
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .returning();
  if (!updated) return c.json({ error: "Failed to update member" }, 500);

  return c.json({ ok: true }, 200);
});

// ---------------------------------------------------------------------------
// 12. Remove project member
// ---------------------------------------------------------------------------
const deleteMemberRoute = createRoute({
  method: "delete",
  path: "/orgs/{orgId}/projects/{projectId}/members/{userId}",
  tags: ["Projects"],
  operationId: "removeProjectMember",
  summary: "Remove a member from a project",
  request: { params: memberParam },
  responses: {
    200: {
      content: { "application/json": { schema: okSchema } },
      description: "Member removed",
    },
    ...errorResponses({ conflict: true }),
  },
});

projectRoutes.openapi(deleteMemberRoute, async (c) => {
  const { orgId, projectId, userId } = c.req.valid("param");
  const access = await requireProjectAccess(c.var.db, orgId, projectId, c.var.auth, "manage");
  if (!access.ok) {
    if (access.status === 404) return c.json({ error: "Project not found" }, 404);
    return c.json({ error: access.status === 401 ? "Unauthorized" : "Forbidden" }, access.status);
  }

  const [existing] = await c.var.db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  if (!existing) return c.json({ error: "Member not found" }, 404);

  // Never orphan a project: refuse to remove its last admin.
  if (existing.role === "admin") {
    const [row] = await c.var.db
      .select({ adminCount: sql<number>`count(*)::int` })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.role, "admin")));
    if ((row?.adminCount ?? 0) <= 1) {
      return c.json({ error: "Cannot remove the last admin of a project" }, 409);
    }
  }

  await c.var.db
    .delete(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));

  return c.json({ ok: true }, 200);
});
