import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { hasTestDb } from "../test-support/db";

/**
 * `/api/auth/*` sits behind a rate limiter whose key is per-IP and truncated to
 * `/api/auth`, so every auth endpoint shared one bucket. At the tight 20/60s
 * budget that meant ordinary console navigation — one `get-session` per route
 * `beforeLoad`, plus hover-preloads, plus the marketing site on the same IP —
 * 429'd real sessions, which the client rendered as "we couldn't verify your
 * session". Session reads now have their own, much larger namespace.
 *
 * Without the native bindings (local + CI) `rateLimit()` falls back to the
 * in-memory limiter using the call-site numbers, which is exactly what these
 * assert. The two paths use different limiter bindings, so their fallback
 * buckets are keyed separately and cannot bleed into each other.
 */
describe("/api/auth/* rate limiting", () => {
  it("does not throttle session reads at the tight auth budget", async () => {
    // Comfortably past the 20/60s auth budget, well under the session budget.
    const statuses: number[] = [];
    for (let i = 0; i < 40; i++) {
      const res = await SELF.fetch("http://localhost/api/auth/get-session");
      statuses.push(res.status);
    }

    expect(statuses).not.toContain(429);
  });

  // Needs a real Postgres: unlike `get-session`, magic-link sign-in reaches the
  // database before the response, so without one the pool dies rather than 429s.
  it.skipIf(!hasTestDb)(
    "still throttles the expensive unauthenticated auth endpoints",
    async () => {
      // magic-link sends mail per request — this is the budget that must stay tight.
      const statuses: number[] = [];
      for (let i = 0; i < 30; i++) {
        const res = await SELF.fetch("http://localhost/api/auth/sign-in/magic-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "rate-limit-probe@example.com" }),
        });
        statuses.push(res.status);
      }

      expect(statuses).toContain(429);
    },
  );
});
