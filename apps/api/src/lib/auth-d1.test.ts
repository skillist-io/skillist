import { env } from "cloudflare:test";
import { accounts, sessions, users } from "@skillist/db/schema";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { testDb } from "../test-support/db";
import { createApiAuth } from "./api-auth";

/**
 * A real sign-in on D1. Better Auth writes the user and session through its Drizzle
 * adapter, and D1 rejects interactive transactions, so if the adapter ever used
 * one, this is the test that fails. Nothing else exercises first-time sign-up.
 */
describe("Better Auth on D1", () => {
  it("creates a user and session from a magic link, then reads them back", async () => {
    const mail: string[] = [];
    const { auth } = createApiAuth(env as unknown as Env, async ({ text, html }) => {
      mail.push(`${text ?? ""} ${html ?? ""}`);
    });
    const origin = new URL((env as unknown as Env).BETTER_AUTH_URL).origin;
    const email = `d1-${crypto.randomUUID()}@example.test`;

    const sent = await auth.handler(
      new Request(`${origin}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({ email }),
      }),
    );
    expect(sent.status).toBe(200);

    const link = mail.join(" ").match(/https?:\/\/[^\s"'<>]+magic-link\/verify[^\s"'<>]+/)?.[0];
    expect(link).toBeDefined();

    const verified = await auth.handler(
      new Request((link as string).replace(/&amp;/g, "&"), { headers: { Origin: origin } }),
    );
    expect(verified.status).toBeLessThan(400);

    const db = testDb();
    const [user] = await db.select().from(users).where(eq(users.email, email));
    expect(user?.createdAt).toBeInstanceOf(Date);
    expect(user?.emailVerified).toBe(true);
    const userSessions = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, user?.id ?? ""));
    expect(userSessions).toHaveLength(1);
    expect(userSessions[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const cookie = verified.headers.get("set-cookie")?.split(";")[0] ?? "";
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.email).toBe(email);
    // Magic-link users have no linked provider row; the query must still work.
    await db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, user?.id ?? ""));
  });
});
