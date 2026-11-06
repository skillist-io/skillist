import { mcpResourceUrl, verifyMcpAccessToken } from "@skillist/auth";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  mcpAuthUrl,
  mcpProtectedResourceMetadata,
  mcpWwwAuthenticate,
  verifyOptionalMcpSession,
} from "./transport";

describe("MCP auth helpers", () => {
  it("builds the Better Auth base URL without a trailing slash", () => {
    expect(mcpAuthUrl("https://api.skillist.dev/")).toBe("https://api.skillist.dev/api/auth");
  });

  it("advertises the OAuth protected-resource metadata in WWW-Authenticate", () => {
    expect(mcpWwwAuthenticate("https://api.skillist.dev")).toBe(
      'Bearer resource_metadata="https://api.skillist.dev/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it("publishes the /mcp resource and the /api/auth issuer", () => {
    expect(mcpProtectedResourceMetadata("https://api.skillist.dev/")).toMatchObject({
      resource: "https://api.skillist.dev/mcp",
      authorization_servers: ["https://api.skillist.dev/api/auth"],
    });
  });

  it("treats a missing or non-Bearer Authorization header as anonymous", async () => {
    const neverCalled = () => {
      throw new Error("must not be called");
    };
    expect(await verifyOptionalMcpSession(neverCalled, undefined)).toBeNull();
    expect(await verifyOptionalMcpSession(neverCalled, "Basic abc")).toBeNull();
  });
});

describe("verifyMcpAccessToken", () => {
  const base = "https://api.skillist.dev";

  async function setup() {
    const { publicKey, privateKey } = await generateKeyPair("EdDSA", { extractable: true });
    const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "EdDSA" };
    const auth = { api: { getJwks: async () => ({ keys: [jwk] }) } };
    const sign = (
      claims: Record<string, unknown> = {},
      opts: { typ?: string; aud?: string; iss?: string; exp?: string } = {},
    ) =>
      new SignJWT({ azp: "client-1", scope: "openid email", ...claims })
        .setProtectedHeader({ alg: "EdDSA", kid: "k1", typ: opts.typ ?? "at+jwt" })
        .setSubject("user-1")
        .setIssuer(opts.iss ?? `${base}/api/auth`)
        .setAudience(opts.aud ?? mcpResourceUrl(base))
        .setExpirationTime(opts.exp ?? "1h")
        .sign(privateKey);
    return { auth, sign };
  }

  it("returns the session for a valid token", async () => {
    const { auth, sign } = await setup();
    await expect(verifyMcpAccessToken(auth, await sign(), base)).resolves.toEqual({
      userId: "user-1",
      clientId: "client-1",
      scopes: ["openid", "email"],
    });
  });

  it.each([
    ["another audience", {}, { aud: "https://api.skillist.dev" }],
    ["another issuer", {}, { iss: "https://evil.example/api/auth" }],
    ["a session JWT", {}, { typ: "JWT" }],
    ["an expired token", {}, { exp: "-1s" }],
    ["a DPoP-bound token", { cnf: { jkt: "thumbprint" } }, {}],
    ["no client", { azp: undefined }, {}],
  ])("rejects %s", async (_name, claims, opts) => {
    const { auth, sign } = await setup();
    await expect(verifyMcpAccessToken(auth, await sign(claims, opts), base)).rejects.toThrow();
  });

  it("rejects a token signed by a key outside the JWKS", async () => {
    const { auth } = await setup();
    const { sign } = await setup();
    await expect(verifyMcpAccessToken(auth, await sign(), base)).rejects.toThrow();
  });
});
