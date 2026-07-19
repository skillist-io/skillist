import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// Regression tests for the Phase 1 access-control hardening. These cover the
// fixes whose gate runs BEFORE any database access, so they run in the standard
// vitest-pool-workers harness (which has no Postgres). The IDOR fixes on
// feedback/version/ai-jobs routes are exercised by the DB-backed suite.

const pushBody = JSON.stringify({
  ref: "refs/heads/main",
  repository: { name: "evil", owner: { login: "attacker" }, default_branch: "main" },
});

describe("GitHub webhook signature enforcement", () => {
  it("rejects a push with no valid signature (401) when a secret is configured", async () => {
    const res = await SELF.fetch("http://localhost/v1/webhooks/github", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-GitHub-Event": "push" },
      body: pushBody,
    });
    expect(res.status).toBe(401);
  });

  it("fails closed with 503 when GITHUB_WEBHOOK_SECRET is unset (no fail-open)", async () => {
    const saved = env.GITHUB_WEBHOOK_SECRET;
    // biome-ignore lint/suspicious/noExplicitAny: test-only env override
    (env as any).GITHUB_WEBHOOK_SECRET = undefined;
    try {
      const res = await SELF.fetch("http://localhost/v1/webhooks/github", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-GitHub-Event": "push" },
        body: pushBody,
      });
      expect(res.status).toBe(503);
    } finally {
      // biome-ignore lint/suspicious/noExplicitAny: test-only env restore
      (env as any).GITHUB_WEBHOOK_SECRET = saved;
    }
  });
});

describe("Security response headers", () => {
  it("sets X-Content-Type-Options: nosniff on responses", async () => {
    const res = await SELF.fetch("http://localhost/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("Telemetry ingestion requires authentication", () => {
  it("rejects anonymous telemetry with 401 (prevents registry metric poisoning)", async () => {
    const res = await SELF.fetch("http://localhost/v1/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgSlug: "victim",
        skillRepo: "widget",
        eventType: "install",
      }),
    });
    expect(res.status).toBe(401);
  });
});
