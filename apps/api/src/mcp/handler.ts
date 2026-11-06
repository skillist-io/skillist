import { createMcpHandler } from "@modelcontextprotocol/server";
import type { Context } from "hono";
import type { Env } from "../env";
import { createWorkerDb } from "../lib/db";
import { buildRegistryMcpServer, mcpServerInfo } from "./registry-server";
import { createRegistryMcpAuth, mcpWwwAuthenticate, verifyOptionalMcpSession } from "./transport";

/**
 * /mcp endpoint — served by the official MCP TypeScript SDK (v2, protocol
 * revision 2026-07-28). The SDK handler is stateless: a fresh McpServer from
 * `buildRegistryMcpServer` serves every request, and its default
 * `legacy: "stateless"` posture answers 2025-era initialize-handshake clients
 * from the same factory (per request, no sessions — legacy GET/DELETE session
 * operations get 405). The pre-SDK KV-backed `Mcp-Session-Id` sessions are
 * gone: nothing here writes KV anymore.
 */
export async function handleMcpRequest(c: Context<{ Bindings: Env }>) {
  const apiBaseUrl = c.env.BETTER_AUTH_URL;
  const accept = c.req.header("Accept") ?? "";

  // Browser/debug affordance kept from the pre-SDK handler: a plain GET
  // (no SSE Accept) returns the server-info doc instead of the spec's 405.
  // MCP clients performing GET always send `Accept: text/event-stream`, so
  // they fall through to the SDK handler and get the spec-mandated answer.
  if (c.req.method === "GET" && !accept.includes("text/event-stream")) {
    return c.json(mcpServerInfo(apiBaseUrl), 200, {
      "WWW-Authenticate": mcpWwwAuthenticate(apiBaseUrl),
    });
  }

  // Bearer tokens are verified here, in front of the SDK handler — the SDK
  // treats auth as pass-through and never reads Authorization itself. A
  // missing/invalid token is not an error: public registry tools stay open to
  // anonymous callers, and only the session-gated tools check for a session.
  // A *thrown* verification failure (e.g. transient trouble reaching Better
  // Auth) degrades to anonymous too, rather than 500ing public reads.
  const authClient = createRegistryMcpAuth(apiBaseUrl);
  let mcpSession: Awaited<ReturnType<typeof verifyOptionalMcpSession>> = null;
  try {
    mcpSession = await verifyOptionalMcpSession(authClient, c.req.header("Authorization"));
  } catch {
    mcpSession = null;
  }

  const db = createWorkerDb(c.env);
  const handler = createMcpHandler(() => buildRegistryMcpServer(db, mcpSession, c.env.SKILLS_R2), {
    // Our tools never emit mid-call notifications, so pin plain JSON
    // responses instead of letting the transport pick JSON-vs-SSE per
    // request. Applies to the modern leg only; the legacy leg answers
    // per its own revision (single-event SSE), and `subscriptions/listen`
    // streams are unaffected either way.
    responseMode: "json",
  });
  const response = await handler.fetch(c.req.raw);

  // Advertise the OAuth resource metadata on every response (not just 401s)
  // so agents can discover how to authenticate before their first gated
  // call — same behavior as the pre-SDK handler.
  const headers = new Headers(response.headers);
  headers.set("WWW-Authenticate", mcpWwwAuthenticate(apiBaseUrl));

  return new Response(response.body, { status: response.status, headers });
}
