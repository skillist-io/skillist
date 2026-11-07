import { env } from "cloudflare:test";
import { agentApprovals, organizations, orgMembers, users } from "@skillist/db/schema";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createWorkerDb } from "../db";
import {
  APPROVAL_TTL_MS,
  callSignature,
  decideApproval,
  effectiveStatus,
  executeApproval,
  getApproval,
  listApprovals,
  listOrgApprovals,
  requireApproval,
  revokeApproval,
} from "./approvals";

describe("effectiveStatus", () => {
  it("only ever changes an approval past its TTL", () => {
    const old = new Date(Date.now() - APPROVAL_TTL_MS - 1000);
    expect(effectiveStatus({ status: "approved", decidedAt: old })).toBe("expired");
    expect(effectiveStatus({ status: "approved", decidedAt: new Date() })).toBe("approved");
    expect(effectiveStatus({ status: "executed", decidedAt: old })).toBe("executed");
    expect(effectiveStatus({ status: "denied", decidedAt: old })).toBe("denied");
  });
});

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
    const first = await requireApproval(db, input);
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

  const ok = async () => ({ ok: true as const });
  const execute = <T>(id: string, run: () => Promise<T>) =>
    executeApproval(db, { orgId, userId, id }, run);

  it.each(["viewer", "publisher"] as const)(
    "refuses a %s without staging a request nobody could decide",
    async (role) => {
      const id = `${role}_${suffix}`;
      await db.insert(users).values({ id, name: role, email: `${id}@ex.com` });
      await db.insert(orgMembers).values({ orgId, userId: id, role });

      const result = await requireApproval(db, { ...call(), userId: id });

      expect(result).toEqual({ ok: false, reason: "needs_editor" });
      const rows = await db.select().from(agentApprovals).where(eq(agentApprovals.userId, id));
      expect(rows).toHaveLength(0);
    },
  );

  it("won't run an approval once its requester has lost the role", async () => {
    const id = `demoted_${suffix}`;
    await db.insert(users).values({ id, name: "D", email: `${id}@ex.com` });
    await db.insert(orgMembers).values({ orgId, userId: id, role: "editor" });
    const approvalId = await stage({ ...call(), userId: id });
    await decideApproval(db, { orgId, userId: id, id: approvalId, status: "approved" });
    await db.update(orgMembers).set({ role: "viewer" }).where(eq(orgMembers.userId, id));
    let ran = false;

    const finished = await executeApproval(db, { orgId, userId: id, id: approvalId }, async () => {
      ran = true;
      return { ok: true as const };
    });

    expect(finished).toBeNull();
    expect(ran).toBe(false);
  });

  it("stages the call and records its conversation", async () => {
    const input = call();
    const result = await requireApproval(db, input);
    expect(result).toMatchObject({ ok: false, status: "awaiting_approval" });
    if (!("approvalId" in result)) throw new Error("expected an approval id");
    const row = await getApproval(db, orgId, userId, result.approvalId);
    expect(row).toMatchObject({ status: "pending", chatId: "chat-1" });
  });

  it("gives a model no way to run anything, even once approved", async () => {
    const input = call();
    const id = await stage(input);
    await approve(id);
    expect(await requireApproval(db, input)).toMatchObject({ status: "awaiting_approval" });
    expect((await getApproval(db, orgId, userId, id))?.status).toBe("approved");
  });

  it("reports a denied call as denied", async () => {
    const input = call();
    const id = await stage(input);
    await decideApproval(db, { orgId, userId, id, status: "denied" });
    expect(await requireApproval(db, input)).toEqual({ ok: false, status: "denied" });
  });

  it("won't run what nobody approved", async () => {
    const id = await stage(call());
    expect(await execute(id, ok)).toBeNull();
    expect((await getApproval(db, orgId, userId, id))?.status).toBe("pending");
  });

  it("runs an approved call once, and a repeat is a new request beside the record", async () => {
    const input = call();
    const id = await stage(input);
    await approve(id);

    const ran = await execute(id, ok);
    expect(ran).toMatchObject({ status: "executed", decidedBy: userId });
    expect(ran?.executedAt).toBeInstanceOf(Date);
    expect(await execute(id, ok)).toBeNull();

    const repeat = await requireApproval(db, { ...input, chatId: "chat-2" });
    if (!("approvalId" in repeat)) throw new Error("expected the repeat to be gated");
    expect(repeat.approvalId).not.toBe(id);

    // The card in the first transcript is keyed to this row, so nothing about it moves.
    expect(await getApproval(db, orgId, userId, id)).toEqual(ran);
    expect(await getApproval(db, orgId, userId, repeat.approvalId)).toMatchObject({
      status: "pending",
      chatId: "chat-2",
    });
  });

  it("runs once when two decisions race", async () => {
    const id = await stage(call());
    await approve(id);
    let runs = 0;
    const once = async () => {
      runs += 1;
      return { ok: true as const };
    };
    const results = await Promise.all([execute(id, once), execute(id, once)]);
    expect(runs).toBe(1);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("lands a retry on the one open request", async () => {
    const input = call();
    const id = await stage(input);
    expect(await stage(input)).toBe(id);
  });

  it("records a refusal and its reason without claiming it ran", async () => {
    const id = await stage(call());
    await approve(id);
    const finished = await execute(id, async () => ({
      ok: false as const,
      reason: "skill_not_found",
    }));
    expect(finished).toMatchObject({
      status: "refused",
      executedAt: null,
      outcomeReason: "skill_not_found",
    });
  });

  it("leaves a run that threw approved, so it can be tried again", async () => {
    const id = await stage(call());
    await approve(id);
    await expect(
      execute(id, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await getApproval(db, orgId, userId, id)).toMatchObject({
      status: "approved",
      executedAt: null,
    });
    expect(await execute(id, ok)).toMatchObject({ status: "executed" });
  });

  it("keeps who approved when an approval is revoked", async () => {
    const input = call();
    const id = await stage(input);
    const approved = await approve(id);
    const revoked = await revokeApproval(db, { orgId, userId, id });
    expect(revoked).toMatchObject({
      status: "revoked",
      decidedBy: userId,
      decidedAt: approved?.decidedAt,
      revokedBy: userId,
    });
    expect(await execute(id, ok)).toBeNull();
    expect(await requireApproval(db, input)).toMatchObject({ status: "awaiting_approval" });
  });

  it("can't revoke what has already run, or another user's approval", async () => {
    const id = await stage(call());
    await approve(id);
    expect(await revokeApproval(db, { orgId, userId: otherUserId, id })).toBeNull();

    await execute(id, ok);
    expect(await revokeApproval(db, { orgId, userId, id })).toBeNull();
    expect((await getApproval(db, orgId, userId, id))?.status).toBe("executed");
  });

  it("won't run an approval past its TTL, and reports it as expired before then", async () => {
    const input = call();
    const id = await stage(input);
    await approve(id);
    const stale = new Date(Date.now() - APPROVAL_TTL_MS - 1000);
    await db.update(agentApprovals).set({ decidedAt: stale }).where(eq(agentApprovals.id, id));

    const listed = await listApprovals(db, orgId, userId, "expired");
    expect(listed.map((r) => r.id)).toContain(id);
    expect((await listApprovals(db, orgId, userId, "approved")).map((r) => r.id)).not.toContain(id);

    expect(await execute(id, ok)).toBeNull();
    expect(await requireApproval(db, input)).toMatchObject({ status: "awaiting_approval" });
    expect((await getApproval(db, orgId, userId, id))?.status).toBe("expired");
  });

  it("pages the org record across members, newest first, without skipping a row", async () => {
    const pageOrg = crypto.randomUUID();
    await db
      .insert(organizations)
      .values({ id: pageOrg, name: `P ${suffix}`, slug: `p-${suffix}` });
    const at = new Date();
    // Same millisecond, so paging has to fall back on the id.
    await db.insert(agentApprovals).values(
      [userId, otherUserId, userId].map((owner, i) => ({
        orgId: pageOrg,
        userId: owner,
        toolName: "remember",
        callSignature: `sig-${i}`,
        status: "denied" as const,
        createdAt: at,
      })),
    );

    const first = await listOrgApprovals(db, pageOrg, { limit: 2 });
    expect(first.rows).toHaveLength(2);
    expect(first.next).not.toBeNull();
    const second = await listOrgApprovals(db, pageOrg, {
      limit: 2,
      before: first.next ?? undefined,
    });
    expect(second.rows).toHaveLength(1);
    expect(second.next).toBeNull();
    const seen = new Set([...first.rows, ...second.rows].map((r) => r.callSignature));
    expect(seen.size).toBe(3);

    const mine = await listOrgApprovals(db, pageOrg, { limit: 10, userId: otherUserId });
    expect(mine.rows.map((r) => r.userId)).toEqual([otherUserId]);
  });

  it("keeps an approval unreachable from another user", async () => {
    const id = await stage(call());
    expect(await getApproval(db, orgId, otherUserId, id)).toBeNull();
    expect(
      await decideApproval(db, { orgId, userId: otherUserId, id, status: "approved" }),
    ).toBeNull();
  });
});
