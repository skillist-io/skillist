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
