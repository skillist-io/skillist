import { passkey } from "@better-auth/passkey";
import * as schema from "@skillist/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { mcp } from "better-auth/plugins";
import { emailOTP } from "better-auth/plugins/email-otp";
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
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:8787",
      "https://skillist.io",
      "https://console.skillist.io",
      "https://api.skillist.io",
    ],
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
      emailOTP({
        async sendVerificationOTP({ email, otp, type }) {
          if (!sendEmail) {
            console.log(`OTP for ${email} (${type}): ${otp}`);
            return;
          }
          await sendEmail({
            to: email,
            subject: "Your Skillist verification code",
            html: `<p>Your code: <strong>${otp}</strong></p>`,
            text: `Your Skillist code: ${otp}`,
          });
        },
      }),
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
