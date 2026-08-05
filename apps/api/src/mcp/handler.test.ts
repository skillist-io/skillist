import { SELF } from "cloudflare:test";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { respondAndCloseWhenDone } from "./handler";

describe("respondAndCloseWhenDone", () => {
  it("runs close only after a slow tool's body has fully drained (legacy SSE leg)", async () => {
    // Reproduces the db-close race: the SDK resolves `fetch` before the legacy
    // leg's SSE body — and the tool handler feeding it — has finished. The
    // wrapper must defer close until the body is drained, i.e. after tool-end.
    const events: string[] = [];
    const handler = createMcpHandler(
      () => {
        const server = new McpServer({ name: "t", version: "1.0.0" });
        server.registerTool(
          "slow",
          { description: "slow tool", inputSchema: z.object({}) },
          async () => {
            events.push("tool-start");
            await new Promise((resolve) => setTimeout(resolve, 20));
            events.push("tool-end");
            return { content: [{ type: "text" as const, text: "ok" }] };
          },
        );
        return server;
      },
      { responseMode: "json" },
    );

    const response = await handler.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        // 2025-era request: no _meta envelope, no modern headers → legacy leg.
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "slow", arguments: {} },
        }),
      }),
    );
    events.push("fetch-resolved");

    const wrapped = respondAndCloseWhenDone(response, new Headers(response.headers), () => {
      events.push("close");
    });
    const text = await wrapped.text();
    events.push("body-drained");

    expect(text).toContain("ok");
    // The race exists: fetch resolves before the tool finished.
    expect(events.indexOf("fetch-resolved")).toBeLessThan(events.indexOf("tool-end"));
    // The fix holds: close only after the tool finished and the body drained.
    expect(events.indexOf("close")).toBeGreaterThan(events.indexOf("tool-end"));
    expect(events).toContain("close");
  });

  it("runs close when the client cancels a streaming body", async () => {
    let closed = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    const endless = new ReadableStream<Uint8Array>({
      start(controller) {
        interval = setInterval(() => controller.enqueue(new TextEncoder().encode(":\n\n")), 5);
      },
      cancel() {
        if (interval) clearInterval(interval);
      },
    });
    const wrapped = respondAndCloseWhenDone(
      new Response(endless, { status: 200 }),
      new Headers(),
      () => {
        closed = true;
      },
    );
    const reader = (wrapped.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    await reader.cancel();
    expect(closed).toBe(true);
  });

  it("runs close immediately for a bodyless response", () => {
    let closed = false;
    const wrapped = respondAndCloseWhenDone(
      new Response(null, { status: 405 }),
      new Headers({ "x-a": "1" }),
      () => {
        closed = true;
      },
    );
    expect(closed).toBe(true);
    expect(wrapped.status).toBe(405);
    expect(wrapped.headers.get("x-a")).toBe("1");
  });
});

describe("handleMcpRequest (full Worker)", () => {
  it("serves the browser info doc on plain GET with WWW-Authenticate", async () => {
    const res = await SELF.fetch("http://localhost/mcp");
    expect(res.status).toBe(200);
    expect(res.headers.get("WWW-Authenticate")).toContain("resource_metadata");
    const body = (await res.json()) as { protocolVersion: string; tools: string[] };
    expect(body.protocolVersion).toBe("2026-07-28");
    expect(body.tools).toContain("registry_search");
  });

  it("answers a modern tools/list POST with cache fields and WWW-Authenticate", async () => {
    const res = await SELF.fetch("http://localhost/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/list",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": { name: "test", version: "1.0.0" },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("WWW-Authenticate")).toContain("resource_metadata");
    const body = (await res.json()) as {
      result: { tools: unknown[]; ttlMs: number; cacheScope: string };
    };
    expect(body.result.tools.length).toBeGreaterThan(0);
    expect(body.result.cacheScope).toBe("public");
  });

  it("answers legacy session operations with 405", async () => {
    const get = await SELF.fetch("http://localhost/mcp", {
      headers: { Accept: "text/event-stream" },
    });
    expect(get.status).toBe(405);
    const del = await SELF.fetch("http://localhost/mcp", { method: "DELETE" });
    expect(del.status).toBe(405);
  });
});
