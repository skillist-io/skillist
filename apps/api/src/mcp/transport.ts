import { type McpSession, mcpResourceUrl } from "@skillist/auth";

export type { McpSession };

export function mcpAuthUrl(apiBaseUrl: string) {
  return `${apiBaseUrl.replace(/\/$/, "")}/api/auth`;
}

/** RFC 9728 metadata. Scopes are omitted: all of ours are identity scopes. */
export function mcpProtectedResourceMetadata(apiBaseUrl: string) {
  return {
    resource: mcpResourceUrl(apiBaseUrl),
    authorization_servers: [mcpAuthUrl(apiBaseUrl)],
    bearer_methods_supported: ["header"],
  };
}

export function mcpWwwAuthenticate(apiBaseUrl: string, error?: "invalid_token") {
  const base = apiBaseUrl.replace(/\/$/, "");
  const metadata = `resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`;
  return error ? `Bearer error="${error}", ${metadata}` : `Bearer ${metadata}`;
}

export async function verifyOptionalMcpSession(
  verify: (token: string) => Promise<McpSession>,
  authorizationHeader: string | undefined,
): Promise<McpSession | null> {
  if (!authorizationHeader?.startsWith("Bearer ")) return null;
  return verify(authorizationHeader.slice(7));
}
