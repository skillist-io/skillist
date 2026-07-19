import { describe, expect, it } from "vitest";
import { handleMcpJsonRpc, REGISTRY_MCP_TOOLS } from "./registry-server";

const mockDb = {} as never;

describe("registry MCP server", () => {
  it("lists registry tools", async () => {
    const res = await handleMcpJsonRpc(mockDb, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    expect(res).toMatchObject({ id: 1 });
    expect((res as { result: { tools: unknown[] } }).result.tools).toHaveLength(
      REGISTRY_MCP_TOOLS.length,
    );
  });

  it("rejects an authenticated tool without a session (JSON-RPC auth error)", async () => {
    const res = await handleMcpJsonRpc(
      mockDb,
      {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: { name: "my_projects", arguments: {} },
      },
      null,
    );
    expect(res).toMatchObject({ id: 10 });
    expect((res as { error?: { code: number } }).error?.code).toBe(-32001);
    expect((res as { result?: unknown }).result).toBeUndefined();
  });

  it("does not auth-gate the legacy public tools when there is no session", async () => {
    // mockDb is empty so the DB read throws, but the call must still reach the
    // handler (surfaced as an isError tool result) rather than a -32001 auth error.
    const res = await handleMcpJsonRpc(
      mockDb,
      {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "registry_facets", arguments: {} },
      },
      null,
    );
    expect(res).toMatchObject({ id: 11 });
    expect((res as { error?: { code: number } }).error).toBeUndefined();
    expect((res as { result?: unknown }).result).toBeDefined();
  });

  it("reaches the project tool handler when a session is present (no -32001)", async () => {
    // With a session, the auth gate passes and the call reaches toolMyProjects.
    // mockDb is empty so the DB read throws — but it must surface as an isError
    // tool result, NOT a -32001 auth error, proving the session was accepted and
    // the handler (and its access-gated DB path) was entered.
    const session = {
      accessToken: "t",
      refreshToken: "t",
      accessTokenExpiresAt: "",
      refreshTokenExpiresAt: "",
      clientId: "c",
      userId: "user-1",
      scopes: "",
    };
    const res = await handleMcpJsonRpc(
      mockDb,
      {
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: { name: "my_projects", arguments: {} },
      },
      session,
    );
    expect(res).toMatchObject({ id: 12 });
    expect((res as { error?: { code: number } }).error).toBeUndefined();
    expect((res as { result?: { isError?: boolean } }).result?.isError).toBe(true);
  });

  it("handles initialize", async () => {
    const res = await handleMcpJsonRpc(mockDb, {
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    });
    expect((res as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe(
      "skillist-registry",
    );
  });
});
