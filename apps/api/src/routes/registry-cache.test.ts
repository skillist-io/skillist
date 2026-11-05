import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { registryRoutes } from "./registry";

/**
 * D1 has no query cache, so these headers are all that keeps public browse
 * traffic off the single database. Losing one wouldn't fail anything else.
 */
describe("registry edge caching", () => {
  it.each(["/v1/registry", "/v1/registry/facets"])("%s is cacheable at the edge", async (path) => {
    const res = await SELF.fetch(`http://localhost${path}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=60, stale-while-revalidate=300, stale-if-error=86400",
    );
  });

  it("doesn't let an error response inherit the cache header", async () => {
    const failing = {
      ...env,
      DB: {
        withSession: () => ({
          prepare: () => {
            throw new Error("D1_ERROR: database unavailable");
          },
        }),
      },
    };
    const res = await registryRoutes.request("/registry", {}, failing).catch(() => null);
    expect(res?.headers.get("cache-control") ?? "").not.toContain("public");
  });

  it("doesn't cache a route that depends on the caller", async () => {
    const res = await SELF.fetch("http://localhost/v1/orgs");
    expect(res.headers.get("cache-control")).not.toContain("public");
  });
});
