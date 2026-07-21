import { sql } from "drizzle-orm";
import type { Env } from "../env";
import { closeWorkerDb, createWorkerDb } from "./db";

/**
 * Deep dependency probe for /health?deep=1.
 *
 * The shallow /health reports static config booleans, so it answered "ok" with
 * a dead database behind it — and the production smoke test asserted on that,
 * which made it worse than useless: it manufactured confidence. This actually
 * touches each dependency.
 *
 * Every probe is individually timed out. A health endpoint that hangs is a
 * health endpoint that takes your uptime monitor down with it.
 */

const PROBE_TIMEOUT_MS = 3_000;

export type ProbeResult = { ok: boolean; ms: number; error?: string };
export type DeepHealth = {
  status: "ok" | "degraded";
  checks: Record<string, ProbeResult>;
};

async function probe(name: string, fn: () => Promise<unknown>): Promise<[string, ProbeResult]> {
  const started = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`timed out after ${PROBE_TIMEOUT_MS}ms`)),
          PROBE_TIMEOUT_MS,
        ),
      ),
    ]);
    return [name, { ok: true, ms: Date.now() - started }];
  } catch (err) {
    return [
      name,
      {
        ok: false,
        ms: Date.now() - started,
        // Surfaced deliberately: an uptime alert is far more actionable with
        // "connection refused" than with a bare false.
        error: err instanceof Error ? err.message : String(err),
      },
    ];
  }
}

export async function checkDependencies(env: Env): Promise<DeepHealth> {
  const db = createWorkerDb(env);
  try {
    const results = await Promise.all([
      probe("postgres", () => db.execute(sql`select 1`)),
      // A read of a key that does not exist still exercises the binding and the
      // edge round-trip, without depending on any particular data being present.
      probe("kv", () => env.SKILLS_KV.get("__health__")),
      probe("r2", () => env.SKILLS_R2.head("__health__")),
    ]);

    const checks = Object.fromEntries(results);
    return {
      status: Object.values(checks).every((c) => c.ok) ? "ok" : "degraded",
      checks,
    };
  } finally {
    await closeWorkerDb(db);
  }
}
