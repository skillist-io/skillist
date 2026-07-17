import * as schema from "@skillist/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { mcp } from "better-auth/plugins";
import { emailOTP } from "better-auth/plugins/email-otp";
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
  return "https://skillist.dev";
}

function resolveAuthBaseURL(env: AuthEnv) {
  if (env.BETTER_AUTH_URL.includes("localhost")) {
    return env.BETTER_AUTH_URL;
  }

  // Auth is served on both skillist.dev/api/* (SPA proxy) and api.skillist.dev.
  return {
    allowedHosts: ["skillist.dev", "api.skillist.dev"],
    fallback: env.BETTER_AUTH_URL,
    protocol: "https" as const,
  };
}

export function createAuth(db: WorkerDb, env: AuthEnv, sendEmail?: EmailSender) {
  const socialProviders = buildSocialProviders(env);
  const webUrl = resolveWebUrl(env);
  const isLocal = env.BETTER_AUTH_URL.includes("localhost");

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
      "http://localhost:8787",
      "https://skillist.dev",
      "https://api.skillist.dev",
    ],
    advanced: isLocal
      ? undefined
      : {
          crossSubDomainCookies: {
            enabled: true,
            domain: ".skillist.dev",
          },
          defaultCookieAttributes: {
            secure: true,
            sameSite: "lax",
          },
        },
    emailAndPassword: {
      enabled: false,
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
      mcp({
        loginPage: `${webUrl}/login`,
        resource: env.BETTER_AUTH_URL,
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
