import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Env } from "../env";
import { enqueueSyncForGithubRepo } from "../lib/github-sync/queue-handler";
import { errorResponses } from "../lib/openapi";

type AppEnv = { Bindings: Env };

export const webhookRoutes = new OpenAPIHono<AppEnv>();

async function verifyGithubSignature(
  secret: string,
  payload: string,
  signatureHeader: string | undefined,
): Promise<boolean> {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const sig = signatureHeader.slice("sha256=".length);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== sig.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  return mismatch === 0;
}

const githubWebhookRoute = createRoute({
  method: "post",
  path: "/webhooks/github",
  tags: ["Webhooks"],
  operationId: "receiveGithubWebhook",
  summary: "Receive a GitHub push webhook and queue a source sync",
  responses: {
    202: {
      description: "Accepted",
      content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
    },
    ...errorResponses({ notFound: false }),
    503: {
      description: "Webhook verification not configured",
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
    },
  },
});

webhookRoutes.openapi(githubWebhookRoute, async (c) => {
  const secret = c.env.GITHUB_WEBHOOK_SECRET;
  const raw = await c.req.text();

  // Fail closed: without a configured secret we cannot authenticate the payload,
  // so reject rather than accepting forged push events for arbitrary repos.
  if (!secret) {
    console.error(JSON.stringify({ msg: "github_webhook_secret_missing" }));
    return c.json({ error: "Webhook verification not configured" }, 503);
  }
  const ok = await verifyGithubSignature(secret, raw, c.req.header("X-Hub-Signature-256"));
  if (!ok) return c.json({ error: "Invalid signature" }, 401);

  // Replay guard: each delivery carries a unique GUID (redeliveries get a fresh
  // one), so a captured valid payload replayed to re-trigger syncs is dropped
  // here. Best-effort — a KV miss just falls through to normal processing, and
  // the sync itself already short-circuits on an unchanged commit SHA.
  const deliveryId = c.req.header("X-GitHub-Delivery");
  if (deliveryId) {
    const dedupeKey = `webhook:gh:${deliveryId}`;
    if (await c.env.SKILLS_KV.get(dedupeKey)) {
      return c.json({ ok: true }, 202);
    }
    // 24h TTL comfortably outlives GitHub's redelivery window without growing
    // KV unbounded.
    c.executionCtx.waitUntil(c.env.SKILLS_KV.put(dedupeKey, "1", { expirationTtl: 86_400 }));
  }

  const event = c.req.header("X-GitHub-Event") ?? "";
  if (event === "ping") return c.json({ ok: true }, 202);

  if (event !== "push") return c.json({ ok: true }, 202);

  let body: {
    ref?: string;
    repository?: { name?: string; owner?: { login?: string }; default_branch?: string };
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const owner = body.repository?.owner?.login;
  const repo = body.repository?.name;
  const defaultBranch = body.repository?.default_branch ?? "main";
  if (!owner || !repo) return c.json({ ok: true }, 202);

  const expectedRef = `refs/heads/${defaultBranch}`;
  if (body.ref !== expectedRef) return c.json({ ok: true }, 202);

  c.executionCtx.waitUntil(
    enqueueSyncForGithubRepo(c.env, owner, repo).then((id) => {
      console.log(JSON.stringify({ msg: "github_webhook_sync", owner, repo, sourceId: id }));
    }),
  );

  return c.json({ ok: true }, 202);
});
