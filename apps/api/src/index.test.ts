import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("skillist api", () => {
  it("health check", async () => {
    const res = await SELF.fetch("http://localhost/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok", service: "skillist-api" });
  });

  it("openapi spec", async () => {
    const res = await SELF.fetch("http://localhost/openapi.json");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      openapi?: string;
      info?: { title?: string };
    };
    expect(body.openapi).toBe("3.1.0");
    expect(body.info?.title).toBe("Skillist API");
  });

  // Workers Caching sits in front of this Worker, so a response with no
  // Cache-Control would be eligible for heuristic caching — and a cached
  // per-user response is a correctness bug, not a slow page. Caching is
  // therefore opt-in: everything else is marked no-store.
  describe("cacheability", () => {
    it("defaults responses to no-store", async () => {
      const res = await SELF.fetch("http://localhost/health");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    });

    it("leaves a route's own Cache-Control alone", async () => {
      // Delivery 404s deliberately carry a short positive TTL so misses don't
      // hammer KV; the default must not overwrite it.
      const res = await SELF.fetch("http://localhost/no-such-org/no-such-skill/SKILL.md");
      expect(res.status).toBe(404);
      expect(res.headers.get("Cache-Control")).toBe("public, max-age=30");
    });
  });
});
