import type { McpSession } from "better-auth/plugins/mcp/client";
import { createMcpAuthClient } from "better-auth/plugins/mcp/client";

const SESSION_PREFIX = "mcp:session:";
const SESSION_TTL_SECONDS = 3600;

export type { McpSession };

export function mcpAuthUrl(apiBaseUrl: string) {
  return `${apiBaseUrl.replace(/\/$/, "")}/api/auth`;
}

export function createRegistryMcpAuth(apiBaseUrl: string) {
  return createMcpAuthClient({
    authURL: mcpAuthUrl(apiBaseUrl),
    resource: apiBaseUrl.replace(/\/$/, ""),
  });
}

export function mcpWwwAuthenticate(apiBaseUrl: string) {
  const resource = apiBaseUrl.replace(/\/$/, "");
  return `Bearer resource_metadata="${resource}/.well-known/oauth-protected-resource"`;
}

export async function verifyOptionalMcpSession(
  authClient: ReturnType<typeof createRegistryMcpAuth>,
  authorizationHeader: string | undefined,
): Promise<McpSession | null> {
  if (!authorizationHeader?.startsWith("Bearer ")) return null;
  return authClient.verifyToken(authorizationHeader.slice(7));
}

export async function createMcpSession(kv: KVNamespace): Promise<string> {
  const id = crypto.randomUUID();
  await kv.put(`${SESSION_PREFIX}${id}`, JSON.stringify({ createdAt: Date.now() }), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return id;
}

export async function validateMcpSession(kv: KVNamespace, sessionId: string): Promise<boolean> {
  const value = await kv.get(`${SESSION_PREFIX}${sessionId}`);
  return value !== null;
}

export async function deleteMcpSession(kv: KVNamespace, sessionId: string): Promise<void> {
  await kv.delete(`${SESSION_PREFIX}${sessionId}`);
}

export function isInitializeRequest(body: unknown): boolean {
  if (Array.isArray(body)) {
    return body.some(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        (item as { method?: string }).method === "initialize",
    );
  }
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { method?: string }).method === "initialize"
  );
}

export function formatSseEvent(data: unknown, event?: string): string {
  const lines: string[] = [];
  if (event) lines.push(`event: ${event}`);
  lines.push(`data: ${JSON.stringify(data)}`);
  return `${lines.join("\n")}\n\n`;
}

export function jsonRpcToSse(payload: Record<string, unknown> | Record<string, unknown>[]): string {
  if (Array.isArray(payload)) {
    return payload.map((item) => formatSseEvent(item, "message")).join("");
  }
  return formatSseEvent(payload, "message");
}

export function createMcpSseStream(sessionId: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let pingTimer: ReturnType<typeof setInterval> | undefined;

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`: session ${sessionId}\n\n`));
      pingTimer = setInterval(() => {
        controller.enqueue(encoder.encode(formatSseEvent({}, "ping")));
      }, 30_000);
    },
    cancel() {
      if (pingTimer) clearInterval(pingTimer);
    },
  });
}
