import { afterEach, describe, expect, it, vi } from "vitest";
import { deliveryRoutes } from "../routes/delivery";
import { getVersionMeta, purgeDeliveryCache } from "./publish";

function stubCache(result: { success: boolean; errors: { code: number; message: string }[] }) {
  const purge = vi.fn(async (_options: CachePurgeOptions) => result);
  return { purge, cache: { purge, invalidate: purge } as CacheContext };
}

describe("purgeDeliveryCache", () => {
  afterEach(() => vi.restoreAllMocks());

  it("purges latest, pinned and browse paths without touching sibling repos", async () => {
    const { purge, cache } = stubCache({ success: true, errors: [] });
    await purgeDeliveryCache(cache, "acme", "widget");

    const prefixes = purge.mock.calls[0]?.[0].pathPrefixes ?? [];
    const matches = (path: string) => prefixes.some((prefix) => path.startsWith(prefix));
    expect(matches("/acme/widget/bundle")).toBe(true);
    expect(matches("/acme/widget@1.2.3/bundle")).toBe(true);
    expect(matches("/acme/widget%401.2.3/meta")).toBe(true);
    expect(matches("/v1/registry")).toBe(true);
    expect(matches("/acme/widget-pro/bundle")).toBe(false);
  });

  it.each([
    ["the context has no cache", () => undefined],
    ["the purge is rejected", () => stubCache({ success: false, errors: [] }).cache],
    [
      "the purge throws",
      () => ({ purge: vi.fn().mockRejectedValue(new Error("boom")) }) as unknown as CacheContext,
    ],
  ])("logs instead of throwing when %s", async (_name, makeCache) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(purgeDeliveryCache(makeCache(), "acme", "widget")).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]?.[0]).toContain("delivery cache purge failed");
  });
});

describe("retraction bounds on pinned delivery", () => {
  it("keeps the version KV read cache short", async () => {
    const get = vi.fn(async () => null);
    await getVersionMeta({ get } as unknown as KVNamespace, "acme", "widget", "1.0.0");
    expect(get).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ cacheTtl: 60 }));
  });

  // A worker-side cache would answer after a purge and refill the outer cache.
  it("does not read or write the Cache API", async () => {
    const match = vi.fn();
    const put = vi.fn();
    const original = globalThis.caches;
    Object.defineProperty(globalThis, "caches", {
      configurable: true,
      value: { default: { match, put } },
    });
    const env = {
      SKILLS_KV: {
        get: async () => null,
        getWithMetadata: async () => ({ value: null, metadata: null }),
      },
      SKILLS_R2: { get: async () => null },
      DB: {},
    } as unknown as Parameters<typeof deliveryRoutes.request>[2];
    try {
      await deliveryRoutes.request("/acme/widget@1.2.3/SKILL.md", {}, env);
      expect(match).not.toHaveBeenCalled();
      expect(put).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, "caches", { configurable: true, value: original });
    }
  });
});
