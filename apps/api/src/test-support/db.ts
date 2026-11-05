import { env } from "cloudflare:test";
import { organizations, orgMembers, users } from "@skillist/db/schema";
import { eq, inArray } from "drizzle-orm";
import type { Env } from "../env";
import { createWorkerDb } from "../lib/db";

/** Helpers for tests that need a real database: Miniflare's local D1. */

/** Local D1 is always present. Kept so suites can state their dependency. */
export const hasTestDb = true;

export function testDb() {
  return createWorkerDb(env as unknown as Env);
}

export async function withDb<T>(fn: (db: ReturnType<typeof testDb>) => Promise<T>): Promise<T> {
  return fn(testDb());
}

let counter = 0;
/** Unique-per-call suffix so parallel tests cannot collide on unique indexes. */
function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export type SeededUser = { id: string; email: string };

/** Creates a user row directly, bypassing the sign-in flow. */
export async function seedUser(db: ReturnType<typeof testDb>): Promise<SeededUser> {
  const id = unique("test-user");
  const email = `${id}@example.test`;
  await db.insert(users).values({ id, name: "Test User", email });
  return { id, email };
}

/** Creates an org owned by `ownerId`, plus any additional members given. */
export async function seedOrg(
  db: ReturnType<typeof testDb>,
  ownerId: string,
  extraMembers: { userId: string; role: "owner" | "editor" | "publisher" | "viewer" }[] = [],
): Promise<{ id: string; slug: string }> {
  const slug = unique("test-org");
  const [org] = await db
    .insert(organizations)
    .values({ slug, name: slug })
    .returning({ id: organizations.id, slug: organizations.slug });
  if (!org) throw new Error("org insert returned no row");

  await db.insert(orgMembers).values({ orgId: org.id, userId: ownerId, role: "owner" });
  for (const member of extraMembers) {
    await db.insert(orgMembers).values({ orgId: org.id, userId: member.userId, role: member.role });
  }
  return org;
}

/**
 * Removes seeded rows. Orgs are deleted explicitly because a user delete only
 * cascades their membership, not the org itself.
 */
export async function cleanup(
  db: ReturnType<typeof testDb>,
  ids: { users?: string[]; orgs?: string[] },
): Promise<void> {
  if (ids.orgs?.length) {
    await db.delete(organizations).where(inArray(organizations.id, ids.orgs));
  }
  if (ids.users?.length) {
    await db.delete(users).where(inArray(users.id, ids.users));
  }
}

/** True when the user row still exists. */
export async function userExists(db: ReturnType<typeof testDb>, userId: string): Promise<boolean> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  return rows.length > 0;
}

/** True when the org row still exists. */
export async function orgExists(db: ReturnType<typeof testDb>, orgId: string): Promise<boolean> {
  const rows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return rows.length > 0;
}
