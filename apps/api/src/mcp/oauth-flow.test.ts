import { env } from "cloudflare:test";
import { mcpResourceUrl, verifyMcpAccessToken } from "@skillist/auth";
import { users } from "@skillist/db/schema";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { createApiAuth } from "../lib/api-auth";
import { testDb } from "../test-support/db";

/**
 * The whole MCP authorization against real D1. Each step depends on Better Auth's
 * table mapping and issuer, which unit tests can't see, so this is what catches a
 * schema or URL mismatch before an agent does.
 */
const workerEnv = env as unknown as Env;
const base = workerEnv.BETTER_AUTH_URL.replace(/\/$/, "");
const authBase = `${base}/api/auth`;
const redirectUri = "http://127.0.0.1:43123/callback";
const origin = "http://localhost:5174";

async function pkce() {
  const verifier = crypto.randomUUID().repeat(2);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { verifier, challenge };
}

function cookiesFrom(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

describe("MCP OAuth flow", () => {
  it("issues a token the /mcp verifier accepts, and refreshes it", async () => {
    let magicLink = "";
    const { auth } = createApiAuth(workerEnv, async ({ text }) => {
      magicLink = text.match(/https?:\/\/\S+/)?.[0] ?? "";
    });
    const call = (path: string, init: RequestInit = {}) =>
      auth.handler(
        new Request(path.startsWith("http") ? path : `${authBase}${path}`, {
          redirect: "manual",
          ...init,
          headers: { origin, ...init.headers },
        }),
      );
    const json = { "content-type": "application/json" };

    const email = `mcp-${crypto.randomUUID()}@example.test`;
    await call("/sign-in/magic-link", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email, callbackURL: `${origin}/dashboard` }),
    });
    expect(magicLink).not.toBe("");
    const verified = await call(magicLink);
    const cookie = cookiesFrom(verified);
    expect(cookie).toContain("session_token");

    // Anonymous, the way an agent registers itself.
    const registered = await call("/oauth2/register", {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        client_name: "Test Agent",
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
      }),
    });
    expect(registered.status).toBeLessThan(300);
    const { client_id: clientId } = (await registered.json()) as { client_id: string };

    const { verifier, challenge } = await pkce();
    const authorizeUrl = new URL(`${authBase}/oauth2/authorize`);
    for (const [key, value] of Object.entries({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "openid email offline_access",
      resource: mcpResourceUrl(base),
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "state-1",
    })) {
      authorizeUrl.searchParams.set(key, value);
    }
    const authorized = await call(authorizeUrl.toString(), { headers: { cookie } });
    const consentUrl = new URL(authorized.headers.get("location") ?? "");
    expect(consentUrl.pathname).toBe("/oauth/consent");

    const consented = await call("/oauth2/consent", {
      method: "POST",
      headers: { ...json, cookie },
      body: JSON.stringify({ accept: true, oauth_query: consentUrl.search.slice(1) }),
    });
    expect(consented.status).toBe(200);
    const { url } = (await consented.json()) as { url: string };
    const code = new URL(url).searchParams.get("code");
    expect(code).toBeTruthy();

    const token = (body: Record<string, string>) =>
      call("/oauth2/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          resource: mcpResourceUrl(base),
          ...body,
        }).toString(),
      });
    const exchanged = await token({
      grant_type: "authorization_code",
      code: code as string,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    });
    expect(exchanged.status).toBe(200);
    const tokens = (await exchanged.json()) as { access_token: string; refresh_token: string };

    const db = testDb();
    const [user] = await db.select().from(users).where(eq(users.email, email));
    await expect(verifyMcpAccessToken(auth, tokens.access_token, base)).resolves.toMatchObject({
      userId: user.id,
      clientId,
    });

    const refreshed = await token({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    });
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as { access_token: string };
    await expect(verifyMcpAccessToken(auth, next.access_token, base)).resolves.toMatchObject({
      userId: user.id,
    });

    // Account deletion must not be blocked by the rows this flow created.
    await db.delete(users).where(eq(users.id, user.id));
  });
});
