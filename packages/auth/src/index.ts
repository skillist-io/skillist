import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins/magic-link";
import { emailOTP } from "better-auth/plugins/email-otp";
import type { WorkerDb } from "./types";
import * as schema from "@skillist/db/schema";
import { buildSocialProviders } from "./social-providers";

export type { WorkerDb } from "./types";
export {
  AUTH_CALLBACK_PATHS,
  authCallbackUrl,
  oauthRedirectUris,
} from "./social-providers";

export type AuthEnv = {
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
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

export function createAuth(
  db: WorkerDb,
  env: AuthEnv,
  sendEmail?: EmailSender,
) {
  const socialProviders = buildSocialProviders(env);

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
        passkey: schema.passkeys,
      },
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [
      env.BETTER_AUTH_URL,
      "http://localhost:5173",
      "http://localhost:8787",
      "https://skillist.dev",
      "https://api.skillist.dev",
    ],
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
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
