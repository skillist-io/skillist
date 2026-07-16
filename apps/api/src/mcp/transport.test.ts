import { describe, expect, it } from "vitest";
import { formatSseEvent, isInitializeRequest, jsonRpcToSse } from "./transport";

describe("MCP transport helpers", () => {
  it("detects initialize requests", () => {
    expect(
      isInitializeRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      }),
    ).toBe(true);
    expect(
      isInitializeRequest({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    ).toBe(false);
  });

  it("formats SSE events", () => {
    expect(formatSseEvent({ ok: true }, "message")).toBe('event: message\ndata: {"ok":true}\n\n');
  });

  it("wraps JSON-RPC responses in SSE", () => {
    const sse = jsonRpcToSse({
      jsonrpc: "2.0",
      id: 1,
      result: { tools: [] },
    });
    expect(sse).toContain("event: message");
    expect(sse).toContain('"tools":[]');
  });
});
