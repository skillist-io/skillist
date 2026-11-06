import { env, SELF } from "cloudflare:test";
import { organizations, orgMembers, users } from "@skillist/db/schema";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mintSession, type Query } from "../../../tests/e2e/mint-session";
import type { Env } from "./env";
import { createWorkerDb } from "./lib/db";

/**
 * CI signs its e2e user in by writing Better Auth's magic-link row by hand, so this
 * pins that format against the real plugin. A Better Auth upgrade that changes it
 * fails here, on the PR, instead of as a red `smoke` job after deploy.
 */
const workerEnv = env as unknown as Env;
const base = workerEnv.BETTER_AUTH_URL.replace(/\/$/, "");

const query: Query = async (sql, params) => {
  const { results } = await workerEnv.DB.prepare(sql)
    .bind(...params)
    .all();
  return results;
};

describe("mintSession", () => {
  const db = createWorkerDb(workerEnv);
  const suffix = crypto.randomUUID().slice(0, 8);
  const orgId = crypto.randomUUID();
  const member = `member_${suffix}@ex.com`;
  const owner = `owner_${suffix}@ex.com`;

  beforeAll(async () => {
    await db.insert(users).values([
      { id: `m_${suffix}`, name: "M", email: member, emailVerified: true },
      { id: `o_${suffix}`, name: "O", email: owner, emailVerified: true },
    ]);
    await db
      .insert(organizations)
      .values({ id: orgId, name: `Org ${suffix}`, slug: `org-${suffix}` });
    await db.insert(orgMembers).values([
      { orgId, userId: `m_${suffix}`, role: "editor" },
      { orgId, userId: `o_${suffix}`, role: "owner" },
    ]);
  });

  // mintSession uses global fetch, which here has to reach the Worker under test.
  beforeEach(() => {
    vi.stubGlobal("fetch", (input: string, init?: RequestInit) => SELF.fetch(input, init));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns cookies the API accepts as that user", async () => {
    const { cookies } = await mintSession(member, base, query);

    const res = await SELF.fetch(`${base}/api/auth/get-session`, {
      headers: { Cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") },
    });
    const session = (await res.json()) as { user?: { email: string } } | null;
    expect(session?.user?.email).toBe(member);
  });

  it("refuses an org owner without writing a token", async () => {
    const write = vi.fn(query);

    await expect(mintSession(owner, base, write)).rejects.toThrow("owns an org");

    expect(write.mock.calls.some(([sql]) => sql.startsWith("INSERT"))).toBe(false);
  });

  it("refuses an unknown email instead of signing it up", async () => {
    const email = `nobody_${suffix}@ex.com`;

    await expect(mintSession(email, base, query)).rejects.toThrow("No user");

    expect(await db.select().from(users).where(eq(users.email, email))).toHaveLength(0);
  });
});
