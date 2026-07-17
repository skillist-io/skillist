import type { McpSession } from "better-auth/plugins/mcp/client";
import type { WorkerDb } from "../lib/db";
import { getRegistryFacets, getRegistrySkill, listRegistry } from "../lib/registry-service";

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
];

function textResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

async function callTool(db: WorkerDb, name: string, args: Record<string, unknown>) {
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
        skillMdUrl: `https://skillist.dev/${org}/${repo}/SKILL.md`,
        registryUrl: `https://skillist.dev/${org}/${repo}`,
        sourceType: skill.sourceType ?? "native",
        upstreamRepo: skill.upstreamRepo ?? null,
        upstreamUrl: skill.upstreamUrl ?? null,
      });
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
  _session: McpSession | null,
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
    try {
      const result = await callTool(db, toolName, toolArgs);
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
  const base = apiBaseUrl?.replace(/\/$/, "") ?? "https://api.skillist.dev";
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
      loginPage: "https://skillist.dev/login",
    },
    session: {
      header: "Mcp-Session-Id",
      sseAccept: "text/event-stream",
    },
    tools: REGISTRY_MCP_TOOLS.map((t) => t.name),
    docs: "https://skillist.dev",
  };
}
