import { type Auth, type AuthEnv, createAuth, type EmailSender } from "@skillist/auth";
import type { Env } from "../env";
import { createWorkerDb } from "./db";

export function authEnvFromBindings(env: Env): AuthEnv {
  return {
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: env.BETTER_AUTH_URL,
    GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
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
        from: "welcome@skillist.dev",
        subject,
        html,
        text,
      });
    } catch {
      console.log(`Email to ${to}: ${subject} — ${text}`);
    }
  };
}
