import { describe, expect, it } from "vitest";

const API_URL = process.env.SMOKE_API_URL ?? "https://api.skillist.dev";
const WEB_URL = process.env.SMOKE_WEB_URL ?? "https://skillist.dev";
const DOCS_URL = process.env.SMOKE_DOCS_URL ?? "https://docs.skillist.dev";

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
      skillRepo: expect.any(String),
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

  it("MCP OAuth discovery metadata is exposed", async () => {
    const res = await fetch(`${API_URL}/.well-known/oauth-protected-resource`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.authorization_servers?.length).toBeGreaterThan(0);
    expect(body.resource).toBeTruthy();
  });

  it("MCP initialize returns session header in streamable mode", async () => {
    const res = await fetch(`${API_URL}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "smoke", version: "1.0.0" },
        },
      }),
    });
    expect(res.ok).toBe(true);
    expect(res.headers.get("Mcp-Session-Id")).toBeTruthy();
    expect(res.headers.get("WWW-Authenticate")).toContain("Bearer");
  });

  it("registry skill detail includes eval metadata", async () => {
    const detail = await fetchJson("/v1/registry/skillist/registry-mcp");
    expect(detail.skillRepo).toBe("registry-mcp");
    // Eval may be absent immediately after a fresh seed
    if (detail.eval) {
      expect(detail.eval.status).toBe("completed");
    }
  });

  it("apex delivery serves SKILL.md", async () => {
    const res = await fetch(`${WEB_URL}/skillist/registry-mcp/SKILL.md`);
    expect(res.ok).toBe(true);
    const body = await res.text();
    expect(body).toContain("name: registry-mcp");
  });

  it("apex skill page loads", async () => {
    const res = await fetch(`${WEB_URL}/skillist/registry-mcp`);
    expect(res.ok).toBe(true);
    const html = await res.text();
    expect(html.length).toBeGreaterThan(100);
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

  it("user docs homepage loads", async () => {
    const res = await fetch(DOCS_URL);
    expect(res.ok).toBe(true);
    const html = await res.text();
    expect(html).toContain("Skillist");
    expect(html).toContain("Registry MCP");
  });
});
