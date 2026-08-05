import type { McpSession } from "better-auth/plugins/mcp/client";
import { createMcpAuthClient } from "better-auth/plugins/mcp/client";

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
