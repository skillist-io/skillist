import { McpServer } from "@modelcontextprotocol/server";
import { addProjectItemSchema } from "@skillist/contracts";
import {
  organizations,
  orgMembers,
  projectItems,
  projectMembers,
  projects,
  skills,
} from "@skillist/db/schema";
import type { McpSession } from "better-auth/plugins/mcp/client";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import { requireProjectAccess } from "../lib/project-access";
import {
  CLI_INSTALL,
  getRegistryFacets,
  getRegistrySkill,
  listRegistry,
} from "../lib/registry-service";

/** The protocol revision this server speaks natively (per-request `_meta`, stateless). */
export const MCP_PROTOCOL_VERSION = "2026-07-28";

/**
 * 2025-era initialize-handshake revisions the SDK's `legacy: "stateless"`
 * posture still serves from the same tool factory (per request, no sessions).
 */
export const MCP_LEGACY_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

export const REGISTRY_MCP_TOOL_NAMES = [
  "registry_search",
  "registry_get_skill",
  "registry_facets",
  "registry_install_help",
  "my_projects",
  "project_skills",
  "add_skill_to_project",
] as const;

function textResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Build a minimal `AuthContext` from a verified MCP session so the project tools
 * can reuse the same `requireProjectAccess` gate as the REST routes. An MCP
 * session is always a user actor — the api-key fields are null/empty so
 * `requireOrgAccess` takes the user (session) branch, never the api-key branch.
 */
function authFromSession(session: McpSession): AuthContext {
  return {
    userId: session.userId,
    apiKeyId: null,
    apiKeyOrgId: null,
    apiKeyCreatedBy: null,
    apiKeyScopes: [],
  };
}

function buildSkillCommands(orgSlug: string, repo: string, runtime: string | null) {
  return {
    cliInstall: CLI_INSTALL,
    installCommand: `skillist install ${orgSlug}/${repo}`,
    runCommand:
      runtime && runtime !== "local"
        ? `skillist run ${orgSlug}/${repo} --script scripts/<script>`
        : null,
    skillMdUrl: `https://skillist.io/${orgSlug}/${repo}/SKILL.md`,
    registryUrl: `https://skillist.io/${orgSlug}/${repo}`,
  };
}

async function toolMyProjects(db: WorkerDb, userId: string) {
  const memberships = await db
    .select({ orgId: orgMembers.orgId, role: orgMembers.role })
    .from(orgMembers)
    .where(eq(orgMembers.userId, userId));
  if (memberships.length === 0) return textResult({ projects: [] });

  // Mirror the REST list route's read-filter: org owners see every project in
  // their org; everyone else sees only shared projects or ones where they hold a
  // project-membership row. Split orgs by whether the user owns them.
  const ownerOrgIds = memberships.filter((m) => m.role === "owner").map((m) => m.orgId);
  const nonOwnerOrgIds = memberships.filter((m) => m.role !== "owner").map((m) => m.orgId);

  const memberProjectIds = db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId));

  const conditions = [];
  if (ownerOrgIds.length > 0) {
    conditions.push(inArray(projects.orgId, ownerOrgIds));
  }
  if (nonOwnerOrgIds.length > 0) {
    conditions.push(
      and(
        inArray(projects.orgId, nonOwnerOrgIds),
        or(eq(projects.visibility, "shared"), inArray(projects.id, memberProjectIds)),
      ),
    );
  }
  const readFilter = conditions.length === 1 ? conditions[0] : or(...conditions);

  const rows = await db
    .select({
      orgId: projects.orgId,
      orgSlug: organizations.slug,
      projectId: projects.id,
      slug: projects.slug,
      name: projects.name,
      description: projects.description,
      visibility: projects.visibility,
      itemCount: sql<number>`count(${projectItems.id})`,
    })
    .from(projects)
    .innerJoin(organizations, eq(projects.orgId, organizations.id))
    .leftJoin(projectItems, eq(projectItems.projectId, projects.id))
    .where(readFilter)
    .groupBy(projects.id, organizations.slug);

  return textResult({
    projects: rows.map((r) => ({ ...r, itemCount: Number(r.itemCount) })),
  });
}

async function toolProjectSkills(
  db: WorkerDb,
  session: McpSession,
  args: { projectId?: string; orgSlug?: string; projectSlug?: string },
) {
  const projectId = args.projectId ?? "";
  const orgSlug = args.orgSlug ?? "";
  const projectSlug = args.projectSlug ?? "";

  const projectQuery = db
    .select({
      id: projects.id,
      orgId: projects.orgId,
      orgSlug: organizations.slug,
      slug: projects.slug,
      name: projects.name,
      description: projects.description,
    })
    .from(projects)
    .innerJoin(organizations, eq(projects.orgId, organizations.id));

  let project: Awaited<typeof projectQuery>[number] | undefined;
  if (projectId) {
    [project] = await projectQuery.where(eq(projects.id, projectId)).limit(1);
  } else if (orgSlug && projectSlug) {
    [project] = await projectQuery
      .where(and(eq(organizations.slug, orgSlug), eq(projects.slug, projectSlug)))
      .limit(1);
  } else {
    throw new Error("Provide projectId, or both orgSlug and projectSlug");
  }
  if (!project) throw new Error("Project not found");

  // Gate on project-level read access (org owner OR any project member OR a
  // shared project). Collapse 403/404 into one message so a non-member can't
  // probe which private projects exist.
  const access = await requireProjectAccess(
    db,
    project.orgId,
    project.id,
    authFromSession(session),
    "read",
  );
  if (!access.ok) {
    throw new Error("Not found or no access");
  }

  const items = await db
    .select({
      itemId: projectItems.id,
      kind: projectItems.kind,
      path: projectItems.path,
      position: projectItems.position,
      label: projectItems.label,
      note: projectItems.note,
      externalUrl: projectItems.externalUrl,
      externalName: projectItems.externalName,
      skillRepo: skills.repo,
      skillVisibility: skills.visibility,
      skillRuntime: skills.runtime,
      skillOrgSlug: organizations.slug,
    })
    .from(projectItems)
    .leftJoin(skills, eq(projectItems.skillId, skills.id))
    .leftJoin(organizations, eq(skills.orgId, organizations.id))
    .where(eq(projectItems.projectId, project.id))
    .orderBy(asc(projectItems.path), asc(projectItems.position));

  const folders = new Map<string, Record<string, unknown>[]>();
  for (const it of items) {
    const folder = it.path || "";
    const base = { label: it.label, note: it.note };
    let entry: Record<string, unknown>;
    if (it.kind === "skill" && it.skillOrgSlug && it.skillRepo) {
      entry = {
        kind: "skill",
        ...base,
        skill: `${it.skillOrgSlug}/${it.skillRepo}`,
        visibility: it.skillVisibility,
        ...buildSkillCommands(it.skillOrgSlug, it.skillRepo, it.skillRuntime),
      };
    } else {
      entry = {
        kind: "external",
        ...base,
        externalUrl: it.externalUrl,
        externalName: it.externalName,
      };
    }
    const bucket = folders.get(folder);
    if (bucket) bucket.push(entry);
    else folders.set(folder, [entry]);
  }

  return textResult({
    projectId: project.id,
    orgSlug: project.orgSlug,
    slug: project.slug,
    name: project.name,
    description: project.description,
    folders: [...folders.entries()].map(([path, entries]) => ({ path, items: entries })),
  });
}

async function toolAddSkillToProject(
  db: WorkerDb,
  session: McpSession,
  args: {
    projectId: string;
    skillId?: string;
    externalUrl?: string;
    externalName?: string;
    path?: string;
  },
) {
  const userId = session.userId;
  const projectId = args.projectId;
  if (!projectId) throw new Error("projectId is required");

  const [project] = await db
    .select({ id: projects.id, orgId: projects.orgId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) throw new Error("Project not found");

  // Writing requires project-level write access: org owner, project
  // editor/admin, or a shared project when the user is org editor+.
  const access = await requireProjectAccess(
    db,
    project.orgId,
    project.id,
    authFromSession(session),
    "write",
  );
  if (!access.ok) {
    throw new Error(
      access.status === 404 ? "Project not found" : "Adding items requires write access",
    );
  }

  const hasSkill = typeof args.skillId === "string" && args.skillId.length > 0;
  const hasExternal = typeof args.externalUrl === "string" && args.externalUrl.length > 0;
  if (hasSkill === hasExternal) {
    throw new Error("Provide exactly one of skillId or externalUrl");
  }

  const parsed = addProjectItemSchema.safeParse({
    kind: hasSkill ? "skill" : "external",
    skillId: hasSkill ? String(args.skillId) : undefined,
    externalUrl: hasExternal ? String(args.externalUrl) : undefined,
    externalName: typeof args.externalName === "string" ? args.externalName : undefined,
    path: typeof args.path === "string" ? args.path : undefined,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  if (parsed.data.kind === "skill") {
    const skillId = parsed.data.skillId as string;
    const [skill] = await db
      .select({ id: skills.id, orgId: skills.orgId, visibility: skills.visibility })
      .from(skills)
      .where(eq(skills.id, skillId))
      .limit(1);
    if (!skill) throw new Error("Skill not found");
    if (skill.orgId !== project.orgId && skill.visibility !== "public") {
      throw new Error("Skill is not visible to this organization");
    }

    const [existing] = await db
      .select({ id: projectItems.id })
      .from(projectItems)
      .where(and(eq(projectItems.projectId, projectId), eq(projectItems.skillId, skill.id)))
      .limit(1);
    if (existing) return textResult({ id: existing.id, duplicate: true });

    const [inserted] = await db
      .insert(projectItems)
      .values({
        projectId,
        kind: "skill",
        skillId: skill.id,
        path: parsed.data.path ?? "",
        label: parsed.data.label ?? null,
        note: parsed.data.note ?? null,
        addedBy: userId,
      })
      .returning({ id: projectItems.id });
    if (!inserted) throw new Error("Failed to add item to project");
    return textResult({ id: inserted.id });
  }

  const externalUrl = parsed.data.externalUrl as string;
  const [existing] = await db
    .select({ id: projectItems.id })
    .from(projectItems)
    .where(and(eq(projectItems.projectId, projectId), eq(projectItems.externalUrl, externalUrl)))
    .limit(1);
  if (existing) return textResult({ id: existing.id, duplicate: true });

  const [inserted] = await db
    .insert(projectItems)
    .values({
      projectId,
      kind: "external",
      externalUrl,
      externalName: parsed.data.externalName ?? null,
      path: parsed.data.path ?? "",
      label: parsed.data.label ?? null,
      note: parsed.data.note ?? null,
      addedBy: userId,
    })
    .returning({ id: projectItems.id });
  if (!inserted) throw new Error("Failed to add item to project");
  return textResult({ id: inserted.id });
}

/**
 * Per-request McpServer factory. The SDK serves one fresh instance per HTTP
 * request (`createMcpHandler`), so the factory closes over the request's db
 * client and verified Better Auth session — no state outlives the request.
 *
 * Auth-gated tools are always registered (the tool list is identical for every
 * caller, which is what lets `tools/list` carry `cacheScope: "public"`); an
 * unauthenticated call to one returns an `isError` tool result telling the
 * agent how to connect, thrown here and converted by the SDK.
 */
export function buildRegistryMcpServer(db: WorkerDb, session: McpSession | null): McpServer {
  const server = new McpServer(
    { name: "skillist-registry", version: "1.0.0" },
    {
      instructions:
        "Search and inspect the public Skillist agent-skills registry (registry_search, " +
        "registry_get_skill, registry_facets, registry_install_help). With an authenticated " +
        "Skillist OAuth session, my_projects / project_skills / add_skill_to_project manage " +
        "the caller's curated skill projects.",
      cacheHints: {
        // The tool list is static and identical for every caller.
        "tools/list": { ttlMs: 300_000, cacheScope: "public" },
        "server/discover": { ttlMs: 3_600_000, cacheScope: "public" },
      },
    },
  );

  const requireSession = (tool: string): McpSession => {
    if (!session) {
      throw new Error(
        `Authentication required: connect with a valid Skillist OAuth token to use "${tool}".`,
      );
    }
    return session;
  };

  server.registerTool(
    "registry_search",
    {
      description:
        "Search the public Skillist agent skills registry by name, description, tags, category, or agent compatibility.",
      inputSchema: z.object({
        query: z.string().optional().describe("Search term (optional)"),
        limit: z.number().optional().describe("Max results (default 10, max 20)"),
        category: z.string().optional().describe("Filter by category"),
        tag: z.string().optional().describe("Filter by tag"),
        agent: z
          .string()
          .optional()
          .describe("Filter by compatible agent (cursor, claude, vscode, mcp)"),
        sourceType: z.string().optional().describe("Filter by origin: native or mirror"),
        sort: z
          .string()
          .optional()
          .describe(
            "relevance (best match for `query`), quality, impact, trending, stars, installs, activations, recent, name",
          ),
      }),
    },
    async (args) => {
      const limit = Math.min(Number(args.limit ?? 10) || 10, 20);
      const result = await listRegistry(db, {
        q: args.query,
        page: 1,
        limit,
        sort: (args.sort ?? "quality") as
          | "relevance"
          | "quality"
          | "trending"
          | "stars"
          | "installs"
          | "recent"
          | "name"
          | "impact"
          | "activations",
        runtime: "all" as const,
        security: "all" as const,
        minQuality: undefined,
        category: args.category,
        tag: args.tag,
        agent: args.agent,
        sourceType:
          args.sourceType === "native" || args.sourceType === "mirror" || args.sourceType === "all"
            ? args.sourceType
            : "all",
      });
      return textResult(result);
    },
  );

  server.registerTool(
    "registry_get_skill",
    {
      description:
        "Get full registry metadata for a skill including eval uplift, install command, plugin.json, and mirror upstream URL when sourceType is mirror.",
      inputSchema: z.object({
        org: z.string().describe("Organization slug, e.g. skillist"),
        repo: z.string().optional().describe("Skill repo name"),
        // Documented legacy alias for `repo`; kept for older agent configs.
        slug: z.string().optional().describe("Legacy alias for repo"),
      }),
    },
    async ({ org, repo, slug }) => {
      const repoName = repo ?? slug ?? "";
      if (!org || !repoName) throw new Error("org and repo are required");
      const skill = await getRegistrySkill(db, org, repoName);
      if (!skill) throw new Error(`Skill not found: ${org}/${repoName}`);
      return textResult(skill);
    },
  );

  server.registerTool(
    "registry_facets",
    {
      description:
        "List available registry filter facets: categories, tags, compatible agents, and sourceTypes (native|mirror).",
      inputSchema: z.object({}),
    },
    async () => textResult(await getRegistryFacets(db)),
  );

  server.registerTool(
    "registry_install_help",
    {
      description: "Return CLI install commands for a skill and global CLI setup instructions.",
      inputSchema: z.object({
        org: z.string(),
        repo: z.string().optional(),
        // Documented legacy alias for `repo`; kept for older agent configs.
        slug: z.string().optional().describe("Legacy alias for repo"),
      }),
    },
    async ({ org, repo: repoArg, slug }) => {
      const repo = repoArg ?? slug ?? "";
      if (!org || !repo) throw new Error("org and repo are required");
      const skill = await getRegistrySkill(db, org, repo);
      if (!skill) throw new Error(`Skill not found: ${org}/${repo}`);
      return textResult({
        cliInstall: skill.cliInstall,
        installCommand: skill.installCommand,
        runCommand:
          skill.runtime && skill.runtime !== "local"
            ? `skillist run ${org}/${repo} --script scripts/<script>`
            : null,
        skillMdUrl: `https://skillist.io/${org}/${repo}/SKILL.md`,
        registryUrl: `https://skillist.io/${org}/${repo}`,
        sourceType: skill.sourceType ?? "native",
        upstreamRepo: skill.upstreamRepo ?? null,
        upstreamUrl: skill.upstreamUrl ?? null,
      });
    },
  );

  server.registerTool(
    "my_projects",
    {
      description:
        "List the Skillist projects the authenticated user can access across every organization they belong to. Requires an authenticated MCP session. Returns only projects the user may read: all projects in orgs they own, plus shared projects and projects they are a member of elsewhere. Returns orgId, orgSlug, projectId, slug, name, description, visibility, and itemCount for each project.",
      inputSchema: z.object({}),
    },
    async () => {
      const s = requireSession("my_projects");
      return toolMyProjects(db, s.userId);
    },
  );

  server.registerTool(
    "project_skills",
    {
      description:
        "List the curated skills and external references in a Skillist project, grouped by folder path, resolved for agent use (install/run commands for skills, URLs for external items). Requires an authenticated MCP session and read access to the project (org owner, a project member, or a shared project). Identify the project by projectId, or by orgSlug + projectSlug.",
      inputSchema: z.object({
        projectId: z.string().optional().describe("Project id (preferred)"),
        orgSlug: z
          .string()
          .optional()
          .describe("Organization slug (use with projectSlug instead of projectId)"),
        projectSlug: z
          .string()
          .optional()
          .describe("Project slug (use with orgSlug instead of projectId)"),
      }),
    },
    async (args) => {
      const s = requireSession("project_skills");
      return toolProjectSkills(db, s, args);
    },
  );

  server.registerTool(
    "add_skill_to_project",
    {
      description:
        "Add a skill or an external reference to a Skillist project. Requires an authenticated MCP session and write access to the project (org owner, a project editor/admin, or a shared project when the user is an org editor or higher). Provide exactly one of skillId (a registry skill visible to the org) or externalUrl (an external link). Duplicates are returned as-is rather than erroring.",
      inputSchema: z.object({
        projectId: z.string().describe("Target project id"),
        skillId: z
          .string()
          .optional()
          .describe("Skill id to add (mutually exclusive with externalUrl)"),
        externalUrl: z
          .string()
          .optional()
          .describe("External URL to add (mutually exclusive with skillId)"),
        externalName: z.string().optional().describe("Display name for an external item"),
        path: z.string().optional().describe("Folder path to group the item under (optional)"),
      }),
    },
    async (args) => {
      const s = requireSession("add_skill_to_project");
      return toolAddSkillToProject(db, s, args);
    },
  );

  return server;
}

export function mcpServerInfo(apiBaseUrl?: string) {
  const base = apiBaseUrl?.replace(/\/$/, "") ?? "https://api.skillist.io";
  return {
    name: "skillist-registry",
    version: "1.0.0",
    description: "Public Skillist agent skills registry MCP server",
    endpoint: "/mcp",
    transport: "streamable-http",
    protocolVersion: MCP_PROTOCOL_VERSION,
    legacyProtocolVersions: MCP_LEGACY_PROTOCOL_VERSIONS,
    oauth: {
      authorizationServer: `${base}/.well-known/oauth-authorization-server`,
      protectedResource: `${base}/.well-known/oauth-protected-resource`,
      // /login lives on the console app; skillist.io/login is not a route and
      // resolves to the SPA shell with a 200, so agents following this URL
      // would land on a soft-404 instead of a sign-in page.
      loginPage: "https://console.skillist.io/login",
    },
    tools: REGISTRY_MCP_TOOL_NAMES,
    docs: "https://docs.skillist.io",
  };
}
