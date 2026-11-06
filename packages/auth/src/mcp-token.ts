import { createLocalJWKSet, errors, jwtVerify } from "jose";

/** Requested by every MCP client. Skillist has no finer-grained MCP scopes yet. */
export const MCP_SCOPES = ["openid", "profile", "email", "offline_access"] as const;

export interface McpSession {
  userId: string;
  clientId: string;
  scopes: string[];
}

/** The MCP resource identifier. Tokens are audience-bound to this exact URL. */
export function mcpResourceUrl(apiBaseUrl: string) {
  return `${apiBaseUrl.replace(/\/$/, "")}/mcp`;
}

/** True when the token itself is bad, as opposed to verification failing to run. */
export function isRejectedMcpToken(err: unknown) {
  return err instanceof errors.JOSEError;
}

interface JwksSource {
  api: { getJwks: () => Promise<{ keys: Parameters<typeof createLocalJWKSet>[0]["keys"] }> };
}

/**
 * Verify an MCP access token inside the Worker.
 *
 * `requireMcpAuth` isn't usable here for two reasons: it rejects anonymous calls,
 * but public registry tools must stay open, and it fetches JWKS over HTTP, which
 * would be this Worker calling its own hostname. Reading the keys through
 * `auth.api` needs no network.
 *
 * Throws on any invalid token. `isRejectedMcpToken` tells that apart from a failure
 * to read the keys, and the caller decides what each one means.
 */
export async function verifyMcpAccessToken(
  auth: JwksSource,
  token: string,
  apiBaseUrl: string,
): Promise<McpSession> {
  const base = apiBaseUrl.replace(/\/$/, "");
  const { keys } = await auth.api.getJwks();
  const { payload } = await jwtVerify(token, createLocalJWKSet({ keys }), {
    issuer: `${base}/api/auth`,
    audience: mcpResourceUrl(base),
    // `at+jwt` is what separates an access token from an ID token or session JWT.
    typ: "at+jwt",
    requiredClaims: ["sub", "azp"],
  });

  // A DPoP-bound token is only valid alongside a proof, and nothing here checks
  // proofs, so accepting one would strip its sender binding.
  if (payload.cnf) throw new errors.JOSEError("DPoP-bound tokens are not supported");

  return {
    userId: payload.sub as string,
    clientId: payload.azp as string,
    scopes: typeof payload.scope === "string" ? payload.scope.split(" ") : [],
  };
}
