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
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import { requireProjectAccess } from "../lib/project-access";
import {
  CLI_INSTALL,
  getRegistryFacets,
  getRegistrySkill,
  listRegistry,
} from "../lib/registry-service";

/** JSON-RPC error code for tools that require an authenticated MCP session. */
const AUTH_REQUIRED_ERROR = -32001;

/** Tools that require a verified Better Auth MCP session (userId). */
const AUTHENTICATED_TOOLS = new Set(["my_projects", "project_skills", "add_skill_to_project"]);

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export const REGISTRY_MCP_TOOLS: McpTool[] = [
  {
    name: "registry_search",
    description:
      "Search the public Skillist agent skills registry by name, description, tags, category, or agent compatibility.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term (optional)" },
        limit: {
          type: "number",
          description: "Max results (default 10, max 20)",
        },
        category: { type: "string", description: "Filter by category" },
        tag: { type: "string", description: "Filter by tag" },
        agent: {
          type: "string",
          description: "Filter by compatible agent (cursor, claude, vscode, mcp)",
        },
        sourceType: {
          type: "string",
          description: "Filter by origin: native or mirror",
        },
        sort: {
          type: "string",
          description: "quality, trending, stars, installs, recent, name",
        },
      },
    },
  },
  {
    name: "registry_get_skill",
    description:
      "Get full registry metadata for a skill including eval uplift, install command, plugin.json, and mirror upstream URL when sourceType is mirror.",
    inputSchema: {
      type: "object",
      properties: {
        org: { type: "string", description: "Organization slug, e.g. skillist" },
        repo: { type: "string", description: "Skill repo name" },
      },
      required: ["org", "repo"],
    },
  },
  {
    name: "registry_facets",
    description:
      "List available registry filter facets: categories, tags, compatible agents, and sourceTypes (native|mirror).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "registry_install_help",
    description: "Return CLI install commands for a skill and global CLI setup instructions.",
    inputSchema: {
      type: "object",
      properties: {
        org: { type: "string" },
        repo: { type: "string" },
      },
      required: ["org", "repo"],
    },
  },
  {
    name: "my_projects",
    description:
      "List the Skillist projects the authenticated user can access across every organization they belong to. Requires an authenticated MCP session. Returns only projects the user may read: all projects in orgs they own, plus shared projects and projects they are a member of elsewhere. Returns orgId, orgSlug, projectId, slug, name, description, visibility, and itemCount for each project.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "project_skills",
    description:
      "List the curated skills and external references in a Skillist project, grouped by folder path, resolved for agent use (install/run commands for skills, URLs for external items). Requires an authenticated MCP session and read access to the project (org owner, a project member, or a shared project). Identify the project by projectId, or by orgSlug + projectSlug.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project id (preferred)" },
        orgSlug: {
          type: "string",
          description: "Organization slug (use with projectSlug instead of projectId)",
        },
        projectSlug: {
          type: "string",
          description: "Project slug (use with orgSlug instead of projectId)",
        },
      },
    },
  },
  {
    name: "add_skill_to_project",
    description:
      "Add a skill or an external reference to a Skillist project. Requires an authenticated MCP session and write access to the project (org owner, a project editor/admin, or a shared project when the user is an org editor or higher). Provide exactly one of skillId (a registry skill visible to the org) or externalUrl (an external link). Duplicates are returned as-is rather than erroring.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Target project id" },
        skillId: {
          type: "string",
          description: "Skill id to add (mutually exclusive with externalUrl)",
        },
        externalUrl: {
          type: "string",
          description: "External URL to add (mutually exclusive with skillId)",
        },
        externalName: {
          type: "string",
          description: "Display name for an external item",
        },
        path: {
          type: "string",
          description: "Folder path to group the item under (optional)",
        },
      },
      required: ["projectId"],
    },
  },
];

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

async function toolProjectSkills(db: WorkerDb, session: McpSession, args: Record<string, unknown>) {
  const projectId = typeof args.projectId === "string" ? args.projectId : "";
  const orgSlug = typeof args.orgSlug === "string" ? args.orgSlug : "";
  const projectSlug = typeof args.projectSlug === "string" ? args.projectSlug : "";

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
  args: Record<string, unknown>,
) {
  const userId = session.userId;
  const projectId = typeof args.projectId === "string" ? args.projectId : "";
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

async function callTool(
  db: WorkerDb,
  name: string,
  args: Record<string, unknown>,
  session: McpSession | null,
) {
  switch (name) {
    case "registry_search": {
      const limit = Math.min(Number(args.limit ?? 10) || 10, 20);
      const result = await listRegistry(db, {
        q: typeof args.query === "string" ? args.query : undefined,
        page: 1,
        limit,
        sort: (typeof args.sort === "string" ? args.sort : "quality") as
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
        category: typeof args.category === "string" ? args.category : undefined,
        tag: typeof args.tag === "string" ? args.tag : undefined,
        agent: typeof args.agent === "string" ? args.agent : undefined,
        sourceType:
          args.sourceType === "native" || args.sourceType === "mirror" || args.sourceType === "all"
            ? args.sourceType
            : "all",
      });
      return textResult(result);
    }
    case "registry_get_skill": {
      const org = String(args.org ?? "");
      const repo = String(args.repo ?? args.slug ?? "");
      if (!org || !repo) {
        throw new Error("org and repo are required");
      }
      const skill = await getRegistrySkill(db, org, repo);
      if (!skill) throw new Error(`Skill not found: ${org}/${repo}`);
      return textResult(skill);
    }
    case "registry_facets": {
      return textResult(await getRegistryFacets(db));
    }
    case "registry_install_help": {
      const org = String(args.org ?? "");
      const repo = String(args.repo ?? args.slug ?? "");
      if (!org || !repo) {
        throw new Error("org and repo are required");
      }
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
    }
    case "my_projects": {
      if (!session) throw new Error("Authentication required");
      return await toolMyProjects(db, session.userId);
    }
    case "project_skills": {
      if (!session) throw new Error("Authentication required");
      return await toolProjectSkills(db, session, args);
    }
    case "add_skill_to_project": {
      if (!session) throw new Error("Authentication required");
      return await toolAddSkillToProject(db, session, args);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function rpcResult(id: string | number | null | undefined, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: string | number | null | undefined, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

async function handleSingle(
  db: WorkerDb,
  req: JsonRpcRequest,
  session: McpSession | null,
): Promise<Record<string, unknown>> {
  const { id, method, params } = req;

  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: {
        name: "skillist-registry",
        version: "1.0.0",
      },
    });
  }

  if (method === "notifications/initialized") {
    return rpcResult(id, {});
  }

  if (method === "ping") {
    return rpcResult(id, {});
  }

  if (method === "tools/list") {
    return rpcResult(id, { tools: REGISTRY_MCP_TOOLS });
  }

  if (method === "tools/call") {
    const toolName = String(params?.name ?? "");
    const toolArgs = (params?.arguments as Record<string, unknown> | undefined) ?? {};
    if (AUTHENTICATED_TOOLS.has(toolName) && !session) {
      return rpcError(
        id,
        AUTH_REQUIRED_ERROR,
        `Authentication required: connect with a valid Skillist OAuth token to use "${toolName}".`,
      );
    }
    try {
      const result = await callTool(db, toolName, toolArgs, session);
      return rpcResult(id, result);
    } catch (err) {
      return rpcResult(id, {
        content: [
          {
            type: "text",
            text: err instanceof Error ? err.message : "Tool call failed",
          },
        ],
        isError: true,
      });
    }
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
}

export async function handleMcpJsonRpc(
  db: WorkerDb,
  body: unknown,
  session: McpSession | null = null,
): Promise<Record<string, unknown> | Record<string, unknown>[]> {
  if (Array.isArray(body)) {
    const responses = await Promise.all(
      body.map((item) => handleSingle(db, item as JsonRpcRequest, session)),
    );
    return responses.filter((r) => r.id !== null && r.id !== undefined) as Record<
      string,
      unknown
    >[];
  }
  return handleSingle(db, body as JsonRpcRequest, session);
}

export function mcpServerInfo(apiBaseUrl?: string) {
  const base = apiBaseUrl?.replace(/\/$/, "") ?? "https://api.skillist.io";
  return {
    name: "skillist-registry",
    version: "1.0.0",
    description: "Public Skillist agent skills registry MCP server",
    endpoint: "/mcp",
    transport: "streamable-http",
    protocolVersion: "2024-11-05",
    oauth: {
      authorizationServer: `${base}/.well-known/oauth-authorization-server`,
      protectedResource: `${base}/.well-known/oauth-protected-resource`,
      loginPage: "https://skillist.io/login",
    },
    session: {
      header: "Mcp-Session-Id",
      sseAccept: "text/event-stream",
    },
    tools: REGISTRY_MCP_TOOLS.map((t) => t.name),
    docs: "https://skillist.io",
  };
}
