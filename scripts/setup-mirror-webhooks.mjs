#!/usr/bin/env node
/**
 * Register GitHub push webhooks for seeded mirror sources where the token has admin access.
 * Third-party org repos (anthropics, cloudflare, etc.) typically require org-level cooperation —
 * those rely on cron sync until webhooks are configured by the upstream owner.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SEEDED_SOURCES = [
  ["anthropics", "skills"],
  ["cloudflare", "skills"],
  ["adobe", "skills"],
  ["microsoft", "azure-skills"],
  ["aws", "agent-toolkit-for-aws"],
];

const API_WEBHOOK = process.env.MIRROR_WEBHOOK_URL ?? "https://api.skillist.io/v1/webhooks/github";

function loadToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const devVars = readFileSync(resolve(process.cwd(), "apps/api/.dev.vars"), "utf8");
    const line = devVars.split("\n").find((l) => l.startsWith("GITHUB_TOKEN="));
    if (line) return line.slice("GITHUB_TOKEN=".length).trim();
  } catch {
    /* optional */
  }
  return "";
}

function loadSecret() {
  if (process.env.GITHUB_WEBHOOK_SECRET) return process.env.GITHUB_WEBHOOK_SECRET;
  try {
    const devVars = readFileSync(resolve(process.cwd(), "apps/api/.dev.vars"), "utf8");
    const line = devVars.split("\n").find((l) => l.startsWith("GITHUB_WEBHOOK_SECRET="));
    if (line) return line.slice("GITHUB_WEBHOOK_SECRET=".length).trim();
  } catch {
    /* optional */
  }
  return "";
}

async function githubJson(url, token, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${url}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function ensureWebhook(owner, repo, token, secret) {
  const hooks = await githubJson(`https://api.github.com/repos/${owner}/${repo}/hooks`, token);
  const existing = hooks.find((h) => h.config?.url === API_WEBHOOK && h.events?.includes("push"));
  if (existing) {
    console.log(`ok  ${owner}/${repo} (hook ${existing.id} exists)`);
    return;
  }

  await githubJson(`https://api.github.com/repos/${owner}/${repo}/hooks`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "web",
      active: true,
      events: ["push"],
      config: {
        url: API_WEBHOOK,
        content_type: "json",
        secret,
        insecure_ssl: "0",
      },
    }),
  });
  console.log(`set ${owner}/${repo}`);
}

async function main() {
  const token = loadToken();
  const secret = loadSecret();
  if (!token) {
    console.error("GITHUB_TOKEN required");
    process.exit(1);
  }
  if (!secret) {
    console.error("GITHUB_WEBHOOK_SECRET required");
    process.exit(1);
  }

  for (const [owner, repo] of SEEDED_SOURCES) {
    try {
      await ensureWebhook(owner, repo, token, secret);
    } catch (err) {
      console.warn(`skip ${owner}/${repo}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

main();
