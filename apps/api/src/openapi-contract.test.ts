import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * Guards the shape of the served OpenAPI document.
 *
 * These are not style checks: each one corresponds to a way the published
 * reference was actually broken, and each would silently regress if the
 * document config were edited without care.
 */
describe("openapi document", () => {
  async function spec() {
    const res = await SELF.fetch("http://localhost/openapi.json");
    expect(res.status).toBe(200);
    return (await res.json()) as {
      servers: { url: string }[];
      paths: Record<string, Record<string, { security?: unknown[] }>>;
      security?: unknown[];
      components?: { securitySchemes?: Record<string, unknown> };
      tags?: { name: string }[];
    };
  }

  it("does not double the /v1 prefix", async () => {
    // Routes are registered under /v1, so a /v1-suffixed server made every URL
    // in the reference resolve to /v1/v1/... and every "Try it" return 404.
    const doc = await spec();
    for (const server of doc.servers) {
      expect(server.url.endsWith("/v1")).toBe(false);
    }
    expect(Object.keys(doc.paths).some((p) => p.startsWith("/v1/"))).toBe(true);
    expect(Object.keys(doc.paths).some((p) => p.startsWith("/v1/v1/"))).toBe(false);
  });

  it("declares both auth schemes", async () => {
    const doc = await spec();
    const schemes = doc.components?.securitySchemes ?? {};
    expect(Object.keys(schemes).sort()).toEqual(["apiKey", "sessionCookie"]);
  });

  it("requires auth by default", async () => {
    const doc = await spec();
    expect(doc.security?.length).toBeGreaterThan(0);
  });

  it("marks the public delivery reads as needing no auth", async () => {
    // These are documented as public and are served from the edge without
    // credentials; inheriting the default would misdocument them.
    const doc = await spec();
    for (const path of ["/{org}/{repo}/SKILL.md", "/{org}/{repo}/meta", "/{org}/{repo}/bundle"]) {
      expect(doc.paths[path]?.get?.security).toEqual([]);
    }
  });

  it("marks public registry browse as needing no auth", async () => {
    const doc = await spec();
    expect(doc.paths["/v1/registry"]?.get?.security).toEqual([]);
  });

  it("still requires auth on a privileged route", async () => {
    // Guards against a blanket security: [] sweep.
    const doc = await spec();
    expect(doc.paths["/v1/orgs/{orgId}/api-keys"]?.post?.security).toBeUndefined();
  });

  it("declares tags so the reference groups coherently", async () => {
    const doc = await spec();
    const names = (doc.tags ?? []).map((t) => t.name);
    expect(names).toContain("Registry");
    expect(names).toContain("Delivery");
  });
});
