import { DurableObject } from "cloudflare:workers";

/** Turns one session may start. Each spends model tokens, so this bounds a session's cost. */
export const MAX_TURNS_PER_SESSION = 50;

/**
 * How long a turn holds the session without a renewal. A Worker that dies
 * mid-turn never releases its lease, so it has to expire. The turn renews after
 * each step, so this only has to outlast ONE step: a whole turn of 12 container
 * scripts can run past 30 minutes, longer than any lease worth waiting out.
 */
const TURN_LEASE_MS = 15 * 60 * 1000;

export type HarnessSessionMeta = {
  orgId: string;
  /** `user:{id}` or `key:{id}`. Sessions are private to the actor that created them. */
  ownerId: string;
  skills: string[];
  allowScripts: boolean;
  createdAt: string;
};

export type BeginTurnResult =
  | { ok: true; token: string; turn: number }
  | { ok: false; reason: "busy" | "turn_limit" };

export type HarnessEvent = { seq: number; turn: number; message: string; createdAt: string };

/**
 * One harness session: an append-only log of model messages plus a turn lease.
 *
 * It stores and serializes, and nothing else. The model loop stays in the
 * Worker request because tools must run with the caller's live credentials: a
 * loop in here would act on a stored identity that outlives a revoked key.
 * Messages cross as opaque JSON strings, so this class knows nothing of their
 * shape and an SDK upgrade can't break stored logs here.
 */
export class SkillHarnessSession extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        turn INTEGER NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  private read(key: string): string | null {
    const rows = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM state WHERE key = ?", key)
      .toArray();
    return rows[0]?.value ?? null;
  }

  private write(key: string, value: string): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      key,
      value,
    );
  }

  /** Write-once: a session's org, owner and skills never change after creation. */
  init(meta: HarnessSessionMeta): boolean {
    if (this.read("meta") !== null) return false;
    this.write("meta", JSON.stringify(meta));
    return true;
  }

  getMeta(): HarnessSessionMeta | null {
    const raw = this.read("meta");
    return raw === null ? null : (JSON.parse(raw) as HarnessSessionMeta);
  }

  /**
   * Take the session for one turn. Counted here, not on completion: a failed
   * turn spent tokens too, and retrying must not be a way around the limit.
   */
  beginTurn(now: number = Date.now()): BeginTurnResult {
    const leaseUntil = Number(this.read("lease_until") ?? 0);
    if (this.read("lease_token") !== null && leaseUntil > now) {
      return { ok: false, reason: "busy" };
    }
    const turn = Number(this.read("turns") ?? 0) + 1;
    if (turn > MAX_TURNS_PER_SESSION) return { ok: false, reason: "turn_limit" };

    const token = crypto.randomUUID();
    this.write("turns", String(turn));
    this.write("lease_token", token);
    this.write("lease_until", String(now + TURN_LEASE_MS));
    return { ok: true, token, turn };
  }

  /** Extend a running turn. False when the lease was lost, which a turn can't recover. */
  renewTurn(token: string, now: number = Date.now()): boolean {
    if (this.read("lease_token") !== token) return false;
    this.write("lease_until", String(now + TURN_LEASE_MS));
    return true;
  }

  /**
   * Append a finished turn and release the lease. Returns false when the lease
   * expired and another turn took over: that turn's history didn't include this
   * one, so appending here would interleave two conversations.
   */
  completeTurn(token: string, turn: number, messages: string[]): boolean {
    if (this.read("lease_token") !== token) return false;
    const createdAt = new Date().toISOString();
    this.ctx.storage.transactionSync(() => {
      for (const message of messages) {
        this.ctx.storage.sql.exec(
          "INSERT INTO events (turn, message, created_at) VALUES (?, ?, ?)",
          turn,
          message,
          createdAt,
        );
      }
      this.ctx.storage.sql.exec("DELETE FROM state WHERE key IN ('lease_token', 'lease_until')");
    });
    return true;
  }

  /** Release after a failed turn. Nothing is logged, so the next turn replays cleanly. */
  abandonTurn(token: string): void {
    if (this.read("lease_token") !== token) return;
    this.ctx.storage.sql.exec("DELETE FROM state WHERE key IN ('lease_token', 'lease_until')");
  }

  /** Every message in order, for replay into the next turn. */
  history(): string[] {
    return this.ctx.storage.sql
      .exec<{ message: string }>("SELECT message FROM events ORDER BY seq")
      .toArray()
      .map((row) => row.message);
  }

  events(after: number, limit: number): HarnessEvent[] {
    return this.ctx.storage.sql
      .exec<{ seq: number; turn: number; message: string; created_at: string }>(
        "SELECT seq, turn, message, created_at FROM events WHERE seq > ? ORDER BY seq LIMIT ?",
        after,
        limit,
      )
      .toArray()
      .map((row) => ({
        seq: row.seq,
        turn: row.turn,
        message: row.message,
        createdAt: row.created_at,
      }));
  }
}
