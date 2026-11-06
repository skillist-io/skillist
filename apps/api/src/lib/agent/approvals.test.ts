import { env } from "cloudflare:test";
import { agentApprovals, organizations, orgMembers, users } from "@skillist/db/schema";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createWorkerDb } from "../db";
import { callSignature, decideApproval, getApproval, requireApproval } from "./approvals";

describe("callSignature", () => {
  it("is stable regardless of argument key order", async () => {
    const a = await callSignature("draft_improvement", { skillRepo: "pdf-tools", note: "fix x" });
    const b = await callSignature("draft_improvement", { note: "fix x", skillRepo: "pdf-tools" });
    expect(a).toBe(b);
  });

  it("is stable regardless of nested key order", async () => {
    const a = await callSignature("t", { outer: { b: 2, a: 1 }, list: [{ y: 1, x: 2 }] });
    const b = await callSignature("t", { list: [{ x: 2, y: 1 }], outer: { a: 1, b: 2 } });
    expect(a).toBe(b);
  });

  it("changes when the tool name changes", async () => {
    const a = await callSignature("draft_improvement", { skillRepo: "pdf-tools" });
    const b = await callSignature("other_tool", { skillRepo: "pdf-tools" });
    expect(a).not.toBe(b);
  });

  it("changes when an argument value changes", async () => {
    const a = await callSignature("draft_improvement", { skillRepo: "pdf-tools", note: "one" });
    const b = await callSignature("draft_improvement", { skillRepo: "pdf-tools", note: "two" });
    expect(a).not.toBe(b);
  });

  it("produces a 64-char hex sha-256 digest", async () => {
    const sig = await callSignature("t", { a: 1 });
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });
});

// The gate itself, against the same local D1 the memory suite uses.
describe("requireApproval", () => {
  let db: ReturnType<typeof createWorkerDb>;
  const suffix = crypto.randomUUID().slice(0, 8);
  const orgId = crypto.randomUUID();
  const userId = `user_${suffix}`;
  const otherUserId = `other_${suffix}`;
  let n = 0;

  /** A fresh call per test, so rows from one test can't satisfy another. */
  const call = () => ({
    orgId,
    userId,
    chatId: "chat-1",
    toolName: "remember",
    args: { key: `k${n++}`, value: "v", scope: "org" },
  });

  const approve = (id: string) => decideApproval(db, { orgId, userId, id, status: "approved" });

  /** Stage a call and return its approval id. */
  async function stage(input: ReturnType<typeof call>) {
    const first = await requireApproval(db, input, async () => ({ ok: true as const }));
    if (!("approvalId" in first)) throw new Error("expected the call to be gated");
    return first.approvalId;
  }

  beforeAll(async () => {
    db = createWorkerDb(env);
    await db.insert(users).values([
      { id: userId, name: "U", email: `u_${suffix}@ex.com` },
      { id: otherUserId, name: "O", email: `o_${suffix}@ex.com` },
    ]);
    await db
      .insert(organizations)
      .values({ id: orgId, name: `Org ${suffix}`, slug: `org-${suffix}` });
    await db.insert(orgMembers).values([
      { orgId, userId, role: "editor" },
      { orgId, userId: otherUserId, role: "editor" },
    ]);
  });

  it.each(["viewer", "publisher"] as const)(
    "refuses a %s without staging a request nobody could decide",
    async (role) => {
      const id = `${role}_${suffix}`;
      await db.insert(users).values({ id, name: role, email: `${id}@ex.com` });
      await db.insert(orgMembers).values({ orgId, userId: id, role });
      let ran = false;

      const result = await requireApproval(db, { ...call(), userId: id }, async () => {
        ran = true;
        return { ok: true as const };
      });

      expect(result).toEqual({ ok: false, reason: "needs_editor" });
      expect(ran).toBe(false);
      const rows = await db.select().from(agentApprovals).where(eq(agentApprovals.userId, id));
      expect(rows).toHaveLength(0);
    },
  );

  it("won't run an approval once its requester has lost the role", async () => {
    const id = `demoted_${suffix}`;
    await db.insert(users).values({ id, name: "D", email: `${id}@ex.com` });
    await db.insert(orgMembers).values({ orgId, userId: id, role: "editor" });
    const input = { ...call(), userId: id };
    const approvalId = await stage(input);
    await decideApproval(db, { orgId, userId: id, id: approvalId, status: "approved" });
    await db.update(orgMembers).set({ role: "viewer" }).where(eq(orgMembers.userId, id));
    let ran = false;

    const result = await requireApproval(db, input, async () => {
      ran = true;
      return { ok: true as const };
    });

    expect(result).toEqual({ ok: false, reason: "needs_editor" });
    expect(ran).toBe(false);
  });

  it("stages the call without running it, and records its conversation", async () => {
    const input = call();
    let ran = false;
    const result = await requireApproval(db, input, async () => {
      ran = true;
      return { ok: true as const };
    });
    expect(ran).toBe(false);
    expect(result).toMatchObject({ ok: false, status: "awaiting_approval" });
    if (!("approvalId" in result)) throw new Error("expected an approval id");
    const row = await getApproval(db, orgId, userId, result.approvalId);
    expect(row).toMatchObject({ status: "pending", chatId: "chat-1" });
  });

  it("does not run a denied call", async () => {
    const input = call();
    const id = await stage(input);
    await decideApproval(db, { orgId, userId, id, status: "denied" });
    let ran = false;
    const result = await requireApproval(db, input, async () => {
      ran = true;
      return { ok: true as const };
    });
    expect(ran).toBe(false);
    expect(result).toEqual({ ok: false, status: "denied" });
  });

  it("runs an approved call once, keeps the record, and re-gates a repeat", async () => {
    const input = call();
    const id = await stage(input);
    await approve(id);

    const result = await requireApproval(db, input, async () => ({ ok: true as const }));
    expect(result).toEqual({ ok: true });
    expect((await getApproval(db, orgId, userId, id))?.status).toBe("executed");

    let ranAgain = false;
    const repeat = await requireApproval(db, input, async () => {
      ranAgain = true;
      return { ok: true as const };
    });
    expect(ranAgain).toBe(false);
    expect(repeat).toMatchObject({ status: "awaiting_approval", approvalId: id });
    expect((await getApproval(db, orgId, userId, id))?.status).toBe("pending");
  });

  it("does not record a refused action as having run", async () => {
    const input = call();
    const id = await stage(input);
    await approve(id);
    const result = await requireApproval(db, input, async () => ({
      ok: false as const,
      reason: "skill_not_found" as const,
    }));
    expect(result).toEqual({ ok: false, reason: "skill_not_found" });
    expect(await getApproval(db, orgId, userId, id)).toBeNull();
  });

  it("keeps an approval unreachable from another user", async () => {
    const id = await stage(call());
    expect(await getApproval(db, orgId, otherUserId, id)).toBeNull();
    expect(
      await decideApproval(db, { orgId, userId: otherUserId, id, status: "approved" }),
    ).toBeNull();
  });
});
