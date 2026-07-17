#!/usr/bin/env node
/**
 * Publish a sync job to skillist-sync-jobs via Cloudflare Queues HTTP API.
 * Requires CLOUDFLARE_API_TOKEN with Queues Edit (or wrangler OAuth token).
 */
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "2d19b3b18648f0776ff1435cba466210";
const QUEUE_ID = process.env.SKILLIST_SYNC_QUEUE_ID ?? "b2a053fc1ce74f6fa0d6fafbbe8cfa32";
const body = process.argv[2] ? JSON.parse(process.argv[2]) : { type: "sync_all" };

const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  console.error("CLOUDFLARE_API_TOKEN required (Queues Edit permission)");
  process.exit(1);
}

const res = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/queues/${QUEUE_ID}/messages`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body }),
  },
);

const text = await res.text();
if (!res.ok) {
  console.error(`Queue publish failed (${res.status}): ${text.slice(0, 300)}`);
  process.exit(1);
}

console.log(`Published ${JSON.stringify(body)} to skillist-sync-jobs`);
