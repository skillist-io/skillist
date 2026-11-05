import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { MAX_TURNS_PER_SESSION } from "./skill-harness-session";

const stub = () => env.SKILL_HARNESS.get(env.SKILL_HARNESS.newUniqueId());
const meta = {
  orgId: "org",
  ownerId: "user:1",
  skills: ["a/b"],
  allowScripts: false,
  createdAt: "2026-11-04T00:00:00.000Z",
};

describe("SkillHarnessSession", () => {
  it("fixes its meta at creation", async () => {
    const session = stub();
    expect(await session.getMeta()).toBeNull();
    expect(await session.init(meta)).toBe(true);
    expect(await session.init({ ...meta, ownerId: "user:2" })).toBe(false);
    expect((await session.getMeta())?.ownerId).toBe("user:1");
  });

  it("allows one turn at a time", async () => {
    const session = stub();
    const first = await session.beginTurn();
    expect(first.ok).toBe(true);
    expect(await session.beginTurn()).toEqual({ ok: false, reason: "busy" });
    if (first.ok) await session.completeTurn(first.token, first.turn, []);
    expect((await session.beginTurn()).ok).toBe(true);
  });

  it("frees a session whose turn died without releasing it", async () => {
    const session = stub();
    const now = Date.now();
    await session.beginTurn(now);
    expect((await session.beginTurn(now + 60_000)).ok).toBe(false);
    expect((await session.beginTurn(now + 16 * 60_000)).ok).toBe(true);
  });

  it("keeps a long turn alive across renewals", async () => {
    const session = stub();
    const now = Date.now();
    const turn = await session.beginTurn(now);
    if (!turn.ok) throw new Error("expected a turn");

    // 40 minutes in, past any single lease, renewed by each step along the way.
    for (const minutes of [10, 20, 30, 40]) {
      expect(await session.renewTurn(turn.token, now + minutes * 60_000)).toBe(true);
      expect(await session.beginTurn(now + (minutes + 1) * 60_000)).toEqual({
        ok: false,
        reason: "busy",
      });
    }
    expect(await session.completeTurn(turn.token, turn.turn, ['"done"'])).toBe(true);
  });

  it("can't renew a lease it lost", async () => {
    const session = stub();
    const now = Date.now();
    const stale = await session.beginTurn(now);
    await session.beginTurn(now + 16 * 60_000);
    if (!stale.ok) throw new Error("expected a turn");
    expect(await session.renewTurn(stale.token, now + 17 * 60_000)).toBe(false);
  });

  it("discards a turn that lost its lease", async () => {
    const session = stub();
    const now = Date.now();
    const stale = await session.beginTurn(now);
    const fresh = await session.beginTurn(now + 16 * 60_000);
    if (!stale.ok || !fresh.ok) throw new Error("expected both turns to start");

    expect(await session.completeTurn(stale.token, stale.turn, ['"stale"'])).toBe(false);
    expect(await session.history()).toEqual([]);
    expect(await session.completeTurn(fresh.token, fresh.turn, ['"fresh"'])).toBe(true);
    expect(await session.history()).toEqual(['"fresh"']);
  });

  it("keeps a failed turn out of the log but counts it", async () => {
    const session = stub();
    const failed = await session.beginTurn();
    if (!failed.ok) throw new Error("expected a turn");
    await session.abandonTurn(failed.token);
    expect(await session.history()).toEqual([]);
    expect(await session.beginTurn()).toMatchObject({ ok: true, turn: 2 });
  });

  it("stops at the turn limit, however the turns ended", async () => {
    const session = stub();
    for (let i = 0; i < MAX_TURNS_PER_SESSION; i++) {
      const turn = await session.beginTurn();
      if (!turn.ok) throw new Error(`turn ${i} refused`);
      await session.abandonTurn(turn.token);
    }
    expect(await session.beginTurn()).toEqual({ ok: false, reason: "turn_limit" });
  });

  it("pages events in order", async () => {
    const session = stub();
    const turn = await session.beginTurn();
    if (!turn.ok) throw new Error("expected a turn");
    await session.completeTurn(turn.token, turn.turn, ['"a"', '"b"', '"c"']);

    const firstPage = await session.events(0, 2);
    expect(firstPage.map((e) => e.message)).toEqual(['"a"', '"b"']);
    const nextPage = await session.events(firstPage[1]?.seq ?? 0, 2);
    expect(nextPage.map((e) => e.message)).toEqual(['"c"']);
  });
});
