import { OpenAPIHono } from "@hono/zod-openapi";
import { apiKeyScopeSchema } from "@skillist/contracts";
import { auditEvents, organizations, orgMembers } from "@skillist/db/schema";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { AuthContext } from "../../lib/auth-middleware";
import { seedOrg, seedUser, testDb } from "../../test-support/db";
import { policiesRoutes } from "./policies";
import type { AppEnv } from "./shared";

type Db = ReturnType<typeof testDb>;

const asUser = (userId: string | null): AuthContext => ({
  userId,
  apiKeyId: null,
  apiKeyOrgId: null,
  apiKeyScopes: [],
  apiKeyCreatedBy: null,
});

/** The real routes and `requireOrgAccess`, with only the sign-in step replaced. */
function request(db: Db, auth: AuthContext, orgId: string, init?: { servePrivateSkills: boolean }) {
  const app = new OpenAPIHono<AppEnv>();
  app.use(async (c, next) => {
    c.set("db", db);
    c.set("auth", auth);
    await next();
  });
  app.route("/", policiesRoutes);
  return app.request(`/orgs/${orgId}/mcp-policy`, {
    method: init ? "PATCH" : "GET",
    headers: { "Content-Type": "application/json" },
    ...(init ? { body: JSON.stringify(init) } : {}),
  });
}

async function storedValue(db: Db, orgId: string) {
  const [org] = await db
    .select({ on: organizations.mcpPrivateSkills })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  return org?.on;
}

describe("MCP policy", () => {
  it("is off for a new org", async () => {
    const db = testDb();
    const owner = await seedUser(db);
    const org = await seedOrg(db, owner.id);

    const res = await request(db, asUser(owner.id), org.id);
    expect(await res.json()).toEqual({ mcpPolicy: { servePrivateSkills: false } });
  });

  it("lets an owner change it, and records who did", async () => {
    const db = testDb();
    const owner = await seedUser(db);
    const org = await seedOrg(db, owner.id);

    const res = await request(db, asUser(owner.id), org.id, { servePrivateSkills: true });
    expect(res.status).toBe(200);
    expect(await storedValue(db, org.id)).toBe(true);

    const logged = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.orgId, org.id), eq(auditEvents.action, "mcp_policy.updated")));
    expect(logged).toHaveLength(1);
    expect(logged[0]?.actorId).toBe(owner.id);
  });

  it("refuses anyone below owner", async () => {
    const db = testDb();
    const owner = await seedUser(db);
    const org = await seedOrg(db, owner.id);
    const stranger = await seedUser(db);
    const editor = await seedUser(db);
    await db.insert(orgMembers).values({ orgId: org.id, userId: editor.id, role: "editor" });

    for (const [auth, status] of [
      [asUser(editor.id), 403],
      [asUser(stranger.id), 403],
      [asUser(null), 401],
    ] as const) {
      const res = await request(db, auth, org.id, { servePrivateSkills: true });
      expect(res.status).toBe(status);
    }
    expect(await storedValue(db, org.id)).toBe(false);
  });

  it("refuses API keys, however many scopes they hold", async () => {
    const db = testDb();
    const owner = await seedUser(db);
    const org = await seedOrg(db, owner.id);

    const res = await request(
      db,
      {
        userId: null,
        apiKeyId: "key",
        apiKeyOrgId: org.id,
        apiKeyScopes: [...apiKeyScopeSchema.options],
        apiKeyCreatedBy: owner.id,
      },
      org.id,
      { servePrivateSkills: true },
    );
    expect(res.status).toBe(403);
    expect(await storedValue(db, org.id)).toBe(false);
  });
});
