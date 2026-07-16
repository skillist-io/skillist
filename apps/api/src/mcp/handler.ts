import type { McpSession } from "better-auth/plugins/mcp/client";
import type { Context } from "hono";
import type { Env } from "../env";
import { createWorkerDb } from "../lib/db";
import { handleMcpJsonRpc, mcpServerInfo } from "./registry-server";
import {
  createMcpSession,
  createMcpSseStream,
  createRegistryMcpAuth,
  deleteMcpSession,
  isInitializeRequest,
  jsonRpcToSse,
  mcpWwwAuthenticate,
  validateMcpSession,
  verifyOptionalMcpSession,
} from "./transport";

function mcpResponseHeaders(apiBaseUrl: string, sessionId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "WWW-Authenticate": mcpWwwAuthenticate(apiBaseUrl),
    "Access-Control-Expose-Headers": "Mcp-Session-Id, WWW-Authenticate, Content-Type",
  };
  if (sessionId) {
    headers["Mcp-Session-Id"] = sessionId;
  }
  return headers;
}

export async function handleMcpRequest(c: Context<{ Bindings: Env }>) {
  const method = c.req.method;
  const accept = c.req.header("Accept") ?? "";
  const sessionId = c.req.header("Mcp-Session-Id");
  const apiBaseUrl = c.env.BETTER_AUTH_URL;
  const authClient = createRegistryMcpAuth(apiBaseUrl);
  const mcpSession = await verifyOptionalMcpSession(authClient, c.req.header("Authorization"));

  if (method === "GET") {
    if (!accept.includes("text/event-stream")) {
      return c.json(mcpServerInfo(apiBaseUrl), 200, mcpResponseHeaders(apiBaseUrl));
    }
    if (!sessionId) {
      return c.json({ error: "Mcp-Session-Id required for SSE" }, 400);
    }
    const valid = await validateMcpSession(c.env.SKILLS_KV, sessionId);
    if (!valid) {
      return c.json({ error: "Session not found" }, 404);
    }
    const stream = createMcpSseStream(sessionId);
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        ...mcpResponseHeaders(apiBaseUrl, sessionId),
      },
    });
  }

  if (method === "DELETE") {
    if (!sessionId) {
      return c.body(null, 400);
    }
    await deleteMcpSession(c.env.SKILLS_KV, sessionId);
    return c.body(null, 204, mcpResponseHeaders(apiBaseUrl));
  }

  if (method !== "POST") {
    return c.json({ error: "Method not allowed" }, 405);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        jsonrpc: "2.0",
        error: { code: -32700, message: "Parse error" },
        id: null,
      },
      400,
      mcpResponseHeaders(apiBaseUrl),
    );
  }

  const wantsSse = accept.includes("text/event-stream");
  const isInitialize = isInitializeRequest(body);

  let activeSessionId = sessionId;
  let newSessionId: string | undefined;

  if (isInitialize && !activeSessionId) {
    newSessionId = await createMcpSession(c.env.SKILLS_KV);
    activeSessionId = newSessionId;
  } else if (activeSessionId) {
    const valid = await validateMcpSession(c.env.SKILLS_KV, activeSessionId);
    if (!valid && !isInitialize) {
      return c.json({ error: "Session not found" }, 404);
    }
  } else if (!isInitialize && wantsSse) {
    return c.json({ error: "Mcp-Session-Id required" }, 400);
  }

  const db = createWorkerDb(c.env);
  const response = await handleMcpJsonRpc(db, body, mcpSession);
  const headers = mcpResponseHeaders(apiBaseUrl, newSessionId ?? activeSessionId);

  if (wantsSse) {
    return new Response(jsonRpcToSse(response), {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        ...headers,
      },
    });
  }

  if (Array.isArray(response)) {
    return c.json(response, 200, headers);
  }
  return c.json(response, 200, headers);
}
