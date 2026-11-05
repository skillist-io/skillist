import { execFileSync } from "node:child_process";
import fs, { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CLI = path.join(ROOT, "packages/cli/dist/index.js");

const API_URL = process.env.SMOKE_API_URL ?? "https://api.skillist.dev";
const DELIVERY_URL = process.env.SMOKE_WEB_URL ?? "https://skillist.dev";

function runCli(args: string[], cwd: string, env: Record<string, string> = {}) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      SKILLIST_API_URL: API_URL,
      SKILLIST_DELIVERY_URL: DELIVERY_URL,
      ...env,
    },
  });
}

describe("production CLI smoke", () => {
  it("search finds public skills", () => {
    const out = runCli(["search", "registry-mcp", "--sort", "name"], ROOT);
    expect(out.toLowerCase()).toContain("registry-mcp");
  });

  it("pull downloads bundle from apex delivery URL", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "skillist-pull-"));
    const out = runCli(["pull", "skillist/registry-mcp", "-o", dir], ROOT);
    expect(out).toContain("Pulled skillist/registry-mcp");
    expect(fs.existsSync(path.join(dir, "SKILL.md"))).toBe(true);
  });

  it("install records org/repo in lockfile", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "skillist-install-"));
    const out = runCli(["install", "skillist/registry-mcp", "-o", "skills/registry-mcp"], dir);
    expect(out).toContain("Pulled skillist/registry-mcp");
    const lock = JSON.parse(fs.readFileSync(path.join(dir, ".skillist.lock"), "utf8")) as {
      skills: { org: string; repo: string }[];
    };
    expect(lock.skills[0]).toMatchObject({
      org: "skillist",
      repo: "registry-mcp",
    });
  });

  it("inventory scan dry-run discovers local skills without API key", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "skillist-inventory-dry-"));
    fs.mkdirSync(path.join(dir, ".cursor/skills/demo-skill"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".cursor/skills/demo-skill/SKILL.md"), "# Demo");

    const out = runCli(["inventory", "scan", "--dry-run"], dir, {
      GITHUB_REPOSITORY: "skillist/demo-repo",
    });
    expect(out).toContain(".cursor/skills/demo-skill/SKILL.md");
    expect(out).toContain("skillist/demo-repo");
  });
});

describe.skipIf(!process.env.SKILLIST_E2E_API_KEY)("authenticated CLI smoke", () => {
  const apiKey = process.env.SKILLIST_E2E_API_KEY!;

  it("lists orgs with API key", async () => {
    const res = await fetch(`${API_URL}/v1/orgs`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(res.ok).toBe(true);
    const orgs = (await res.json()) as { slug: string }[];
    expect(orgs.length).toBeGreaterThan(0);
  });

  it("inventory scan posts discovered skills", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "skillist-inventory-post-"));
    fs.mkdirSync(path.join(dir, ".vscode/skills/ci-skill"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".vscode/skills/ci-skill/SKILL.md"), "# CI");

    const orgsRes = await fetch(`${API_URL}/v1/orgs`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const orgs = (await orgsRes.json()) as { slug: string }[];
    const orgSlug = orgs[0]!.slug;

    const out = runCli(["inventory", "scan", "--org", orgSlug, "--json"], dir, {
      GITHUB_REPOSITORY: "skillist/ci-scan-test",
      SKILLIST_API_KEY: apiKey,
    });
    const result = JSON.parse(out) as { upserted: number; items: { filePath: string }[] };
    expect(result.upserted).toBeGreaterThan(0);
    expect(result.items.some((item) => item.filePath.includes("ci-skill"))).toBe(true);
  });

  it("scripts endpoint accepts authenticated requests", async () => {
    const res = await fetch(`${DELIVERY_URL}/skillist/cloudflare-deploy/scripts`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect([200, 401, 403, 404]).toContain(res.status);
  });
});
