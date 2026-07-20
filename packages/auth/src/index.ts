import { passkey } from "@better-auth/passkey";
import * as schema from "@skillist/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { mcp } from "better-auth/plugins";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { magicLink } from "better-auth/plugins/magic-link";
import { buildSocialProviders } from "./social-providers";
import type { WorkerDb } from "./types";

export {
  AUTH_CALLBACK_PATHS,
  authCallbackUrl,
  oauthRedirectUris,
} from "./social-providers";
export type { WorkerDb } from "./types";

export type AuthEnv = {
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  WEB_URL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Enterprise OIDC / SSO (generic OAuth) */
  SSO_PROVIDER_ID?: string;
  SSO_CLIENT_ID?: string;
  SSO_CLIENT_SECRET?: string;
  SSO_DISCOVERY_URL?: string;
  SSO_AUTHORIZATION_URL?: string;
  SSO_TOKEN_URL?: string;
  SSO_USERINFO_URL?: string;
  SSO_SCOPES?: string;
  /** Console app origin (console.skillist.io); the authed surfaces + /login. */
  CONSOLE_URL?: string;
};

export type EmailSender = (params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}) => Promise<void>;

export function resolveWebUrl(env: AuthEnv): string {
  if (env.WEB_URL) return env.WEB_URL.replace(/\/$/, "");
  if (env.BETTER_AUTH_URL.includes("localhost")) {
    return "http://localhost:5173";
  }
  return "https://skillist.io";
}

/** Console app origin — where /login and the authed surfaces live. */
export function resolveConsoleUrl(env: AuthEnv): string {
  if (env.CONSOLE_URL) return env.CONSOLE_URL.replace(/\/$/, "");
  if (env.BETTER_AUTH_URL.includes("localhost")) {
    return "http://localhost:5174";
  }
  return "https://console.skillist.io";
}

function resolveAuthBaseURL(env: AuthEnv) {
  if (env.BETTER_AUTH_URL.includes("localhost")) {
    return env.BETTER_AUTH_URL;
  }

  // Auth is served same-origin on skillist.io/api/*, console.skillist.io/api/*
  // (SPA worker proxies) and api.skillist.io.
  return {
    allowedHosts: ["skillist.io", "console.skillist.io", "api.skillist.io"],
    fallback: env.BETTER_AUTH_URL,
    protocol: "https" as const,
  };
}

function buildSsoPlugin(env: AuthEnv) {
  if (!env.SSO_CLIENT_ID || !env.SSO_CLIENT_SECRET) return null;
  const providerId = env.SSO_PROVIDER_ID?.trim() || "sso";
  const scopes = (env.SSO_SCOPES ?? "openid email profile").split(/\s+/).filter(Boolean);

  if (env.SSO_DISCOVERY_URL) {
    return genericOAuth({
      config: [
        {
          providerId,
          clientId: env.SSO_CLIENT_ID,
          clientSecret: env.SSO_CLIENT_SECRET,
          discoveryUrl: env.SSO_DISCOVERY_URL,
          scopes,
          pkce: true,
        },
      ],
    });
  }

  if (env.SSO_AUTHORIZATION_URL && env.SSO_TOKEN_URL) {
    return genericOAuth({
      config: [
        {
          providerId,
          clientId: env.SSO_CLIENT_ID,
          clientSecret: env.SSO_CLIENT_SECRET,
          authorizationUrl: env.SSO_AUTHORIZATION_URL,
          tokenUrl: env.SSO_TOKEN_URL,
          userInfoUrl: env.SSO_USERINFO_URL,
          scopes,
          pkce: true,
        },
      ],
    });
  }

  return null;
}

export function createAuth(db: WorkerDb, env: AuthEnv, sendEmail?: EmailSender) {
  const socialProviders = buildSocialProviders(env);
  const webUrl = resolveWebUrl(env);
  const consoleUrl = resolveConsoleUrl(env);
  const isLocal = env.BETTER_AUTH_URL.includes("localhost");
  const ssoPlugin = buildSsoPlugin(env);

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
        passkey: schema.passkeys,
        oauthApplication: schema.oauthApplications,
        oauthAccessToken: schema.oauthAccessTokens,
        oauthConsent: schema.oauthConsents,
      },
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: resolveAuthBaseURL(env),
    trustedOrigins: [
      env.BETTER_AUTH_URL,
      webUrl,
      // Local origins only in local dev. trustedOrigins gates callbackURL
      // validation, so shipping localhost to production would let a crafted
      // callbackURL bounce a real OAuth flow to http://localhost:*.
      ...(isLocal
        ? ["http://localhost:5173", "http://localhost:5174", "http://localhost:8787"]
        : []),
      "https://skillist.io",
      "https://console.skillist.io",
      "https://api.skillist.io",
    ],
    // Pin the session lifecycle rather than inheriting it. cookieCache is the
    // consequential one: without it every getSession() — and authMiddleware
    // calls it on every /v1 request — is a Postgres round-trip through the
    // cache-disabled Hyperdrive.
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 15,
      cookieCache: { enabled: true, maxAge: 60 },
    },
    // MUST be explicit. `enabled` defaults to Better Auth's `isProduction`,
    // which reads NODE_ENV — and deployed Workers do not set NODE_ENV, so left
    // to the default this is silently OFF in production.
    //
    // storage stays "memory", which on Workers is per-isolate and so cannot be
    // a global limit on its own. The authoritative distributed limit is the
    // native Workers Rate Limiting binding applied to /api/auth/* in
    // apps/api/src/index.ts; these rules add per-endpoint granularity on top.
    // ("secondary-storage" is deliberately not used: supplying secondaryStorage
    // also relocates session storage out of Postgres into KV, which is
    // eventually consistent and would weaken session revocation.)
    rateLimit: {
      enabled: true,
      storage: "memory",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/magic-link": { window: 300, max: 3 },
        "/magic-link/verify": { window: 300, max: 10 },
        "/passkey/verify-authentication": { window: 60, max: 10 },
        "/mcp/register": { window: 3600, max: 5 },
      },
    },
    advanced: isLocal
      ? undefined
      : {
          crossSubDomainCookies: {
            enabled: true,
            domain: ".skillist.io",
          },
          defaultCookieAttributes: {
            secure: true,
            sameSite: "lax",
          },
        },
    emailAndPassword: {
      enabled: false,
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["github", "google"],
      },
    },
    socialProviders,
    plugins: [
      magicLink({
        // Pinned rather than inherited. Better Auth's defaults (5 min,
        // single-use) are what we want, but they should not be able to change
        // under us on a dependency bump for a credential delivered by email.
        expiresIn: 300,
        sendMagicLink: async ({ email, url }) => {
          if (!sendEmail) {
            console.log(`Magic link for ${email}: ${url}`);
            return;
          }
          await sendEmail({
            to: email,
            subject: "Sign in to Skillist",
            html: `<p>Click <a href="${url}">here</a> to sign in to Skillist.</p>`,
            text: `Sign in to Skillist: ${url}`,
          });
        },
      }),
      // NOTE: emailOTP was removed. It had no client plugin and no UI, so its
      // only effect was to expose an unauthenticated, unthrottled
      // /api/auth/email-otp/send-verification-otp that anyone could use to fan
      // out mail from welcome@skillist.io. Re-add it together with a client,
      // rate limits, and disableSignUp if OTP sign-in is ever wanted.
      passkey({
        // rpID is the registrable parent domain so passkeys work on both
        // skillist.io and console.skillist.io.
        rpID: isLocal ? "localhost" : "skillist.io",
        rpName: "Skillist",
        origin: isLocal
          ? ["http://localhost:5173", "http://localhost:5174", "http://localhost:8787"]
          : ["https://skillist.io", "https://console.skillist.io", "https://api.skillist.io"],
      }),
      mcp({
        // /login lives on the console app now.
        loginPage: `${consoleUrl}/login`,
        resource: env.BETTER_AUTH_URL,
      }),
      ...(ssoPlugin ? [ssoPlugin] : []),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
