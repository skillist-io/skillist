import { createMiddleware } from "hono/factory";
import type { Env } from "../env";

// Primary path: the native Workers Rate Limiting binding (RATE_LIMITER),
// configured in wrangler as 120 requests / 60s. It enforces the limit globally
// across isolates and colos. When the binding is absent — local dev or tests —
// this falls back to the bounded in-memory limiter below.
//
// The fallback is per-isolate/per-colo: it curbs abusive bursts against a single
// isolate and keeps its memory footprint bounded via the sweep, but is not a
// global limit. Both paths stay cheap enough for the hot path.

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

/** Reap expired buckets, then hard-cap the map by dropping the oldest keys. */
function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key);
  }
  if (buckets.size > MAX_BUCKETS) {
    // Map iterates in insertion order, so the leading keys are the oldest.
    const excess = buckets.size - MAX_BUCKETS;
    let removed = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (++removed >= excess) break;
    }
  }
}

export const rateLimit = (limit = 120, windowMs = 60_000) =>
  createMiddleware<{ Bindings: Env }>(async (c, next) => {
    const ip = c.req.header("cf-connecting-ip") ?? "local";
    const key = `${ip}:${c.req.path.split("/").slice(0, 3).join("/")}`;

    // Prefer the native binding when present (distributed, authoritative).
    const limiter = c.env.RATE_LIMITER;
    if (limiter) {
      const { success } = await limiter.limit({ key });
      if (!success) return c.json({ error: "Rate limit exceeded" }, 429);
      await next();
      return;
    }

    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || now > bucket.resetAt) {
      // Opportunistically reap on the reset path so an unbounded stream of
      // unique ip:path keys can't grow the map without limit.
      if (buckets.size >= MAX_BUCKETS) sweep(now);
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      await next();
      return;
    }

    if (bucket.count >= limit) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    bucket.count += 1;
    await next();
  });
