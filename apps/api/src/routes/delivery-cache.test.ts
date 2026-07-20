import { describe, expect, it } from "vitest";
import { deliveryRoutes } from "./delivery";

/**
 * Covers the edge-cache wrapper on pinned-version delivery. The invariant that
 * matters is WHICH responses get into the shared cache: an exact version may be
 * cached, `latest` must not be (it is mutable), and a non-200 must not be
 * (caching a 404 or a fail-closed visibility response would outlive the
 * condition that produced it).
 */

type CacheCall = { url: string };

function stubCaches(): { puts: CacheCall[]; matches: CacheCall[]; restore: () => void } {
  const puts: CacheCall[] = [];
  const matches: CacheCall[] = [];
  const original = (globalThis as { caches?: unknown }).caches;

  (globalThis as { caches?: unknown }).caches = {
    default: {
      match: async (req: Request) => {
        matches.push({ url: req.url });
        return undefined;
      },
      put: async (req: Request) => {
        puts.push({ url: req.url });
      },
    },
  };

  return {
    puts,
    matches,
    restore: () => {
      (globalThis as { caches?: unknown }).caches = original;
    },
  };
}

// Minimal env: the KV stub returns nothing, so unpinned reads 404 without
// needing R2 or a database.
const env = {
  SKILLS_KV: {
    get: async () => null,
    getWithMetadata: async () => ({ value: null, metadata: null }),
  },
  SKILLS_R2: {},
} as unknown as Parameters<typeof deliveryRoutes.request>[2];

describe("pinned-version edge cache", () => {
  it("does not consult or populate the cache for mutable latest", async () => {
    const c = stubCaches();
    try {
      await deliveryRoutes.request("/acme/widget/SKILL.md", {}, env);
      // `@latest` parses to an unpinned specifier, so it must take the same
      // uncached path as a bare repo.
      await deliveryRoutes.request("/acme/widget@latest/SKILL.md", {}, env);
      expect(c.matches).toHaveLength(0);
      expect(c.puts).toHaveLength(0);
    } finally {
      c.restore();
    }
  });

  it("consults the cache for an exact version", async () => {
    const c = stubCaches();
    try {
      await deliveryRoutes.request("/acme/widget@1.2.3/SKILL.md", {}, env);
      expect(c.matches).toHaveLength(1);
      expect(c.matches[0]?.url).toContain("/acme/widget@1.2.3/SKILL.md");
    } finally {
      c.restore();
    }
  });

  it("does not cache a non-200 (missing skill fails closed)", async () => {
    const c = stubCaches();
    try {
      const res = await deliveryRoutes.request("/acme/widget@1.2.3/SKILL.md", {}, env);
      expect(res.status).not.toBe(200);
      expect(c.puts).toHaveLength(0);
    } finally {
      c.restore();
    }
  });
});
