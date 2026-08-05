import { createMcpHandler } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import {
  buildRegistryMcpServer,
  MCP_PROTOCOL_VERSION,
  mcpServerInfo,
  REGISTRY_MCP_TOOL_NAMES,
} from "./registry-server";
import type { McpSession } from "./transport";

const mockDb = {} as never;

const session: McpSession = {
  accessToken: "t",
  refreshToken: "t",
  accessTokenExpiresAt: "",
  refreshTokenExpiresAt: "",
  clientId: "c",
  userId: "user-1",
  scopes: "",
};

function handlerFor(activeSession: McpSession | null = null) {
  return createMcpHandler(() => buildRegistryMcpServer(mockDb, activeSession), {
    responseMode: "json",
  });
}

/** A 2026-07-28 request: required headers + the `_meta` envelope in params. */
function modernRequest(
  method: string,
  params: Record<string, unknown> = {},
  headerOverrides: Record<string, string> = {},
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    "Mcp-Method": method,
    ...(typeof params.name === "string" ? { "Mcp-Name": params.name } : {}),
    ...headerOverrides,
  };
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "1.0.0" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
}

/** A 2025-era request: no per-request `_meta`, no modern headers. */
function legacyRequest(method: string, params: Record<string, unknown> = {}) {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

describe("registry MCP server (2026-07-28)", () => {
  it("lists all registry tools with public cache hints", async () => {
    const res = await handlerFor().fetch(modernRequest("tools/list"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { tools: { name: string }[]; ttlMs: number; cacheScope: string };
    };
    expect(body.result.tools.map((t) => t.name).sort()).toEqual(
      [...REGISTRY_MCP_TOOL_NAMES].sort(),
    );
    expect(body.result.ttlMs).toBe(300_000);
    expect(body.result.cacheScope).toBe("public");
  });

  it("answers server/discover with the supported protocol version", async () => {
    const res = await handlerFor().fetch(modernRequest("server/discover"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { supportedVersions: string[]; capabilities: Record<string, unknown> };
    };
    expect(body.result.supportedVersions).toContain(MCP_PROTOCOL_VERSION);
    expect(body.result.capabilities).toHaveProperty("tools");
  });

  it("rejects a header/body mismatch with HeaderMismatch (-32020)", async () => {
    const res = await handlerFor().fetch(
      modernRequest("tools/list", {}, { "Mcp-Method": "tools/call" }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code: number } };
    expect(body.error?.code).toBe(-32020);
  });

  it("returns an auth-required tool error for a gated tool without a session", async () => {
    const res = await handlerFor(null).fetch(
      modernRequest("tools/call", { name: "my_projects", arguments: {} }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { isError?: boolean; content: { text: string }[] };
      error?: unknown;
    };
    expect(body.error).toBeUndefined();
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content[0]?.text).toContain("Authentication required");
  });

  it("does not auth-gate the public tools when there is no session", async () => {
    // mockDb is empty so the DB read throws, but the call must still reach the
    // handler (surfaced as an isError tool result), not an auth-required error.
    const res = await handlerFor(null).fetch(
      modernRequest("tools/call", { name: "registry_facets", arguments: {} }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { isError?: boolean; content: { text: string }[] };
    };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content[0]?.text).not.toContain("Authentication required");
  });

  it("reaches the project tool handler when a session is present", async () => {
    // With a session, the auth gate passes and the call reaches toolMyProjects.
    // mockDb is empty so the DB read throws — but it must surface as a non-auth
    // isError result, proving the session was accepted and the handler entered.
    const res = await handlerFor(session).fetch(
      modernRequest("tools/call", { name: "my_projects", arguments: {} }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { isError?: boolean; content: { text: string }[] };
    };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content[0]?.text).not.toContain("Authentication required");
  });

  it("serves 2025-era initialize-handshake clients from the same factory", async () => {
    const res = await handlerFor().fetch(
      legacyRequest("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      }),
    );
    expect(res.status).toBe(200);
    // The legacy leg answers per the 2025 revision: an SSE stream when the
    // client's Accept includes text/event-stream (responseMode only pins the
    // modern leg). Parse the single `message` event's data line.
    const text = await res.text();
    const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
    expect(dataLine).toBeDefined();
    const body = JSON.parse((dataLine as string).slice("data: ".length)) as {
      result: { protocolVersion: string; serverInfo: { name: string } };
    };
    expect(body.result.serverInfo.name).toBe("skillist-registry");
    expect(body.result.protocolVersion).toBe("2025-06-18");
  });

  it("answers legacy session operations (GET/DELETE) with 405, not a session", async () => {
    const handler = handlerFor();
    const get = await handler.fetch(
      new Request("http://localhost/mcp", {
        method: "GET",
        headers: { Accept: "text/event-stream" },
      }),
    );
    expect(get.status).toBe(405);
    const del = await handler.fetch(new Request("http://localhost/mcp", { method: "DELETE" }));
    expect(del.status).toBe(405);
  });
});

describe("mcpServerInfo", () => {
  it("advertises the modern protocol version and no session transport", async () => {
    const info = mcpServerInfo("https://api.skillist.io");
    expect(info.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(info.legacyProtocolVersions).toContain("2025-06-18");
    expect(info).not.toHaveProperty("session");
    expect(info.tools).toEqual(REGISTRY_MCP_TOOL_NAMES);
  });
});
