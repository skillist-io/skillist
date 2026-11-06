import { env } from "cloudflare:test";
import { agentMemory, organizations, users } from "@skillist/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createWorkerDb } from "../db";
import {
  buildMemoryBlock,
  forgetFact,
  formatMemoryBlock,
  hasOrgFact,
  rememberFact,
  searchMemory,
} from "./memory";

// ---------------------------------------------------------------------------
// Always-on: pure formatting, no database.
// ---------------------------------------------------------------------------
describe("formatMemoryBlock", () => {
  it("returns an empty string for no memories", () => {
    expect(formatMemoryBlock([])).toBe("");
  });

  it("formats a compact known-facts block", () => {
    const block = formatMemoryBlock([
      { key: "policy:security-pass", value: "every skill needs a security pass" },
      { key: "convention:skill-naming", value: "lowercase-hyphenated" },
    ]);
    expect(block).toBe(
      [
        "Known facts about this org:",
        "- policy:security-pass: every skill needs a security pass",
        "- convention:skill-naming: lowercase-hyphenated",
      ].join("\n"),
    );
  });
});

// ---------------------------------------------------------------------------
// DB-backed suite. The default vitest-pool-workers harness has no D1
// (DB is a placeholder host), so this runs only when an explicit
// local D1 var flags a live D1 — same gate as
// routes/projects.test.ts.
// ---------------------------------------------------------------------------
const REAL_DB = true;

/** The provenance every write must now state. */
const PROV = { source: "console", updatedBy: null } as const;

describe.skipIf(!REAL_DB)("memory lib — integration (requires DB)", () => {
  let db: ReturnType<typeof createWorkerDb>;
  const suffix = crypto.randomUUID().slice(0, 8);
  const orgId = crypto.randomUUID();
  const userId = `user_${suffix}`;
  const otherUserId = `other_${suffix}`;

  beforeAll(async () => {
    if (!REAL_DB) return;
    db = createWorkerDb(env);
    await db.insert(users).values([
      { id: userId, name: "U", email: `u_${suffix}@ex.com` },
      { id: otherUserId, name: "O", email: `o_${suffix}@ex.com` },
    ]);
    await db
      .insert(organizations)
      .values({ id: orgId, name: `Org ${suffix}`, slug: `org-${suffix}` });
  });

  it("redacts PII in the value before persisting (org-scoped upsert)", async () => {
    const { redaction } = await rememberFact(db, {
      orgId,
      userId: null,
      key: "contact",
      value: "reach ops at ops@ex.com or 555-123-4567",
      ...PROV,
    });
    expect(redaction.matches.map((m) => m.name)).toEqual(
      expect.arrayContaining(["email", "phone"]),
    );
    const [row] = await db
      .select({ value: agentMemory.value })
      .from(agentMemory)
      .where(
        and(
          eq(agentMemory.orgId, orgId),
          isNull(agentMemory.userId),
          eq(agentMemory.key, "contact"),
        ),
      )
      .limit(1);
    expect(row?.value).toContain("[email]");
    expect(row?.value).toContain("[phone]");
    expect(row?.value).not.toContain("ops@ex.com");
  });

  it("upserts the same key in place rather than duplicating", async () => {
    await rememberFact(db, { orgId, userId: null, key: "policy", value: "v1", ...PROV });
    await rememberFact(db, { orgId, userId: null, key: "policy", value: "v2", ...PROV });
    const rows = await db
      .select({ value: agentMemory.value })
      .from(agentMemory)
      .where(
        and(
          eq(agentMemory.orgId, orgId),
          isNull(agentMemory.userId),
          eq(agentMemory.key, "policy"),
        ),
      );
    expect(rows.length).toBe(1);
    expect(rows[0]?.value).toBe("v2");
  });

  it("search respects visibility: org-wide + own rows, not other users'", async () => {
    await rememberFact(db, { orgId, userId, key: "mine", value: "user fact", ...PROV });
    await rememberFact(db, {
      orgId,
      userId: otherUserId,
      key: "theirs",
      value: "other fact",
      ...PROV,
    });

    const visible = await searchMemory(db, orgId, userId);
    const keys = visible.map((r) => r.key);
    expect(keys).toContain("mine"); // own row
    expect(keys).toContain("policy"); // org-wide row
    expect(keys).not.toContain("theirs"); // another user's row hidden
  });

  it("search keyword-filters over key and value", async () => {
    const hits = await searchMemory(db, orgId, userId, "user fact");
    expect(hits.map((r) => r.key)).toContain("mine");
    expect(hits.map((r) => r.key)).not.toContain("policy");
  });

  it("buildMemoryBlock returns a formatted block and '' without org scope", async () => {
    expect(await buildMemoryBlock(db, null, userId)).toBe("");
    const block = await buildMemoryBlock(db, orgId, userId);
    expect(block).toContain("Known facts about this org:");
    expect(block).toContain("- mine: user fact");
  });

  it("records who wrote a fact and how, and reports the writer's name", async () => {
    await rememberFact(db, {
      orgId,
      userId: null,
      key: "provenance",
      value: "written by the agent",
      source: "agent",
      updatedBy: userId,
    });
    const [row] = await searchMemory(db, orgId, null, "provenance");
    expect(row).toMatchObject({ source: "agent", updatedBy: userId, updatedByName: "U" });
  });

  it("hasOrgFact sees org-wide facts only, which is what gates forgetting", async () => {
    await rememberFact(db, { orgId, userId, key: "personal-only", value: "mine", ...PROV });
    await rememberFact(db, { orgId, userId: null, key: "shared", value: "ours", ...PROV });
    expect(await hasOrgFact(db, orgId, "personal-only")).toBe(false);
    expect(await hasOrgFact(db, orgId, "shared")).toBe(true);
  });

  it("forget deletes an org-wide fact by key", async () => {
    await rememberFact(db, { orgId, userId: null, key: "temp", value: "delete me", ...PROV });
    await forgetFact(db, orgId, userId, "temp");
    const rows = await db
      .select()
      .from(agentMemory)
      .where(
        and(eq(agentMemory.orgId, orgId), isNull(agentMemory.userId), eq(agentMemory.key, "temp")),
      );
    expect(rows.length).toBe(0);
  });
});
