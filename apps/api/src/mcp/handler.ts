import { createMcpHandler } from "@modelcontextprotocol/server";
import type { Context } from "hono";
import type { Env } from "../env";
import { closeWorkerDb, createWorkerDb, safeExecutionCtx } from "../lib/db";
import { buildRegistryMcpServer, mcpServerInfo } from "./registry-server";
import { createRegistryMcpAuth, mcpWwwAuthenticate, verifyOptionalMcpSession } from "./transport";

/**
 * Rewrap an SDK response so `close` runs only once the body has actually
 * finished (fully streamed to the client, or the client cancelled) — NOT when
 * `handler.fetch` resolves. The SDK can resolve `fetch` while the body stream
 * (and the tool handler feeding it, with its in-flight DB queries) is still
 * being produced — most visibly on the legacy SSE leg — so closing the db in a
 * `finally` around `fetch` races tool DB work and kills queries mid-call.
 *
 * `flush` fires when the SDK's stream completes normally; `cancel` when the
 * client aborts. If the runtime lacks transformer-cancel support, an aborted
 * stream skips `close` and the connection lingers until isolate eviction —
 * the same (accepted) behavior every request had before the SDK migration.
 */
export function respondAndCloseWhenDone(
  response: Response,
  headers: Headers,
  close: () => unknown,
): Response {
  const init = { status: response.status, statusText: response.statusText, headers };
  if (!response.body) {
    close();
    return new Response(null, init);
  }
  let closed = false;
  const closeOnce = () => {
    if (!closed) {
      closed = true;
      close();
    }
  };
  const monitor = new TransformStream<Uint8Array, Uint8Array>({
    flush() {
      closeOnce();
    },
    cancel() {
      closeOnce();
    },
  });
  return new Response(response.body.pipeThrough(monitor), init);
}

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
  let response: Response;
  try {
    const handler = createMcpHandler(() => buildRegistryMcpServer(db, mcpSession), {
      // Our tools never emit mid-call notifications, so pin plain JSON
      // responses instead of letting the transport pick JSON-vs-SSE per
      // request. Applies to the modern leg only; the legacy leg answers
      // per its own revision (single-event SSE), and `subscriptions/listen`
      // streams are unaffected either way.
      responseMode: "json",
    });
    response = await handler.fetch(c.req.raw);
  } catch (err) {
    closeWorkerDb(db, safeExecutionCtx(c));
    throw err;
  }

  // Advertise the OAuth resource metadata on every response (not just 401s)
  // so agents can discover how to authenticate before their first gated
  // call — same behavior as the pre-SDK handler.
  const headers = new Headers(response.headers);
  headers.set("WWW-Authenticate", mcpWwwAuthenticate(apiBaseUrl));

  // Release the db only after the body is done — see respondAndCloseWhenDone.
  return respondAndCloseWhenDone(response, headers, () => closeWorkerDb(db, safeExecutionCtx(c)));
}
