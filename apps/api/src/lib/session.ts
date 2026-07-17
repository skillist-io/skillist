import { createAuth } from "@skillist/auth";
import type { Env } from "../env";
import type { AuthContext } from "./auth-middleware";
import type { WorkerDb } from "./db";

type SessionContext = {
  env: Env;
  req: { raw: Request };
  var: { auth: AuthContext; db: WorkerDb };
};

export async function resolveUserId(c: SessionContext): Promise<string | null> {
  if (c.var.auth.userId) return c.var.auth.userId;

  const auth = createAuth(c.var.db, {
    BETTER_AUTH_SECRET: c.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: c.env.BETTER_AUTH_URL,
    WEB_URL: c.env.WEB_URL,
    GITHUB_CLIENT_ID: c.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: c.env.GITHUB_CLIENT_SECRET,
    GOOGLE_CLIENT_ID: c.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: c.env.GOOGLE_CLIENT_SECRET,
  });
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session?.user?.id ?? null;
}

export async function resolveSessionUserId(
  db: WorkerDb,
  env: Env,
  headers: Headers,
): Promise<string | null> {
  const auth = createAuth(db, {
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: env.BETTER_AUTH_URL,
    WEB_URL: env.WEB_URL,
    GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
  });
  const session = await auth.api.getSession({ headers });
  return session?.user?.id ?? null;
}
