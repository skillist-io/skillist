import { type Auth, type AuthEnv, createAuth, type EmailSender } from "@skillist/auth";
import type { Env } from "../env";
import { createWorkerDb } from "./db";

export function authEnvFromBindings(env: Env): AuthEnv {
  return {
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: env.BETTER_AUTH_URL,
    WEB_URL: env.WEB_URL,
    GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    SSO_PROVIDER_ID: env.SSO_PROVIDER_ID,
    SSO_CLIENT_ID: env.SSO_CLIENT_ID,
    SSO_CLIENT_SECRET: env.SSO_CLIENT_SECRET,
    SSO_DISCOVERY_URL: env.SSO_DISCOVERY_URL,
    SSO_AUTHORIZATION_URL: env.SSO_AUTHORIZATION_URL,
    SSO_TOKEN_URL: env.SSO_TOKEN_URL,
    SSO_USERINFO_URL: env.SSO_USERINFO_URL,
    SSO_SCOPES: env.SSO_SCOPES,
  };
}

export function createApiAuth(env: Env, sendEmail?: EmailSender): Auth {
  const db = createWorkerDb(env);
  return createAuth(db, authEnvFromBindings(env), sendEmail);
}

export function createApiEmailSender(env: Env): EmailSender {
  return async ({ to, subject, html, text }) => {
    try {
      await env.EMAIL.send({
        to,
        from: "welcome@skillist.io",
        subject,
        html,
        text,
      });
    } catch (err) {
      // Never log the body/subject: magic-link and OTP emails carry live auth
      // credentials, and logs are sampled/retained. Record the failure only.
      console.error(
        JSON.stringify({
          msg: "email_send_failed",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  };
}
