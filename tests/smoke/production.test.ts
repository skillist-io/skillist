import { describe, expect, it } from "vitest";

const API_URL = process.env.SMOKE_API_URL ?? "https://api.skillist.dev";
const WEB_URL = process.env.SMOKE_WEB_URL ?? "https://skillist.dev";

async function fetchJson(path: string, init?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, init);
  expect(res.ok).toBe(true);
  return res.json();
}

describe("production smoke", () => {
  it("health reports MCP server", async () => {
    const health = await fetchJson("/health");
    expect(health.status).toBe("ok");
    expect(health.mcp?.tools).toContain("registry_search");
  });

  it("registry lists public skills", async () => {
    const registry = await fetchJson("/v1/registry");
    expect(registry.items?.length).toBeGreaterThan(0);
    expect(registry.items[0]).toMatchObject({
      orgSlug: expect.any(String),
      skillSlug: expect.any(String),
    });
  });

  it("MCP tools/list returns registry tools", async () => {
    const res = await fetch(`${API_URL}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });
    expect(res.ok).toBe(true);
    const body = await res.json();
    const names = body.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "registry_search",
        "registry_get_skill",
        "registry_facets",
        "registry_install_help",
      ]),
    );
  });

  it("registry skill detail includes eval metadata", async () => {
    const detail = await fetchJson("/v1/registry/skillist/registry-mcp");
    expect(detail.skillSlug).toBe("registry-mcp");
    expect(detail.eval?.status).toBe("completed");
  });

  it("web homepage loads", async () => {
    const res = await fetch(WEB_URL);
    expect(res.ok).toBe(true);
    const html = await res.text();
    expect(html).toContain("Skillist — Agent Skills Platform");
    expect(html).toContain('id="root"');
  });

  it("web registry page loads", async () => {
    const res = await fetch(`${WEB_URL}/registry`);
    expect(res.ok).toBe(true);
    const html = await res.text();
    expect(html.length).toBeGreaterThan(100);
  });
});
