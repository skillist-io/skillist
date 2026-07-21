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
    // Set the secret explicitly: it comes from .dev.vars locally but is absent
    // in CI, and without it the handler correctly fails closed with 503 (covered
    // by the next test). Pin it here so this case always exercises the 401 path.
    const saved = env.GITHUB_WEBHOOK_SECRET;
    (env as Record<string, unknown>).GITHUB_WEBHOOK_SECRET = "test-webhook-secret";
    try {
      const res = await SELF.fetch("http://localhost/v1/webhooks/github", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-GitHub-Event": "push" },
        body: pushBody,
      });
      expect(res.status).toBe(401);
    } finally {
      (env as Record<string, unknown>).GITHUB_WEBHOOK_SECRET = saved;
    }
  });

  it("fails closed with 503 when GITHUB_WEBHOOK_SECRET is unset (no fail-open)", async () => {
    const saved = env.GITHUB_WEBHOOK_SECRET;
    (env as Record<string, unknown>).GITHUB_WEBHOOK_SECRET = undefined;
    try {
      const res = await SELF.fetch("http://localhost/v1/webhooks/github", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-GitHub-Event": "push" },
        body: pushBody,
      });
      expect(res.status).toBe(503);
    } finally {
      (env as Record<string, unknown>).GITHUB_WEBHOOK_SECRET = saved;
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

async function signPayload(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256=${hex}`;
}

describe("GitHub webhook replay protection", () => {
  const SECRET = "test-webhook-secret";
  const pingBody = JSON.stringify({ zen: "Keep it logically awesome." });

  async function postPing(deliveryId: string) {
    const saved = env.GITHUB_WEBHOOK_SECRET;
    (env as Record<string, unknown>).GITHUB_WEBHOOK_SECRET = SECRET;
    try {
      return await SELF.fetch("http://localhost/v1/webhooks/github", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GitHub-Event": "ping",
          "X-GitHub-Delivery": deliveryId,
          "X-Hub-Signature-256": await signPayload(SECRET, pingBody),
        },
        body: pingBody,
      });
    } finally {
      (env as Record<string, unknown>).GITHUB_WEBHOOK_SECRET = saved;
    }
  }

  it("records the delivery id and stays idempotent on replay", async () => {
    const deliveryId = crypto.randomUUID();
    const first = await postPing(deliveryId);
    expect(first.status).toBe(202);

    // The replay guard writes the delivery id to KV; a replayed delivery is
    // then short-circuited (still 202, but not reprocessed).
    const second = await postPing(deliveryId);
    expect(second.status).toBe(202);
    expect(await env.SKILLS_KV.get(`webhook:gh:${deliveryId}`)).toBe("1");
  });

  it("short-circuits a delivery whose id is already seen", async () => {
    const deliveryId = crypto.randomUUID();
    await env.SKILLS_KV.put(`webhook:gh:${deliveryId}`, "1");
    const res = await postPing(deliveryId);
    expect(res.status).toBe(202);
  });
});
