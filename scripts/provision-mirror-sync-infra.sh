#!/usr/bin/env bash
# One-time Cloudflare infra for GitHub mirror sync (queue + redeploy).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="$ROOT/apps/api"

echo "==> Ensure skillist-sync-jobs queue exists"
cd "$API_DIR"
pnpm exec wrangler queues create skillist-sync-jobs --config wrangler.production.jsonc 2>/dev/null || \
  echo "queue already exists (ok)"

echo "==> Deploy API (creates sync-source-workflow binding)"
pnpm build
pnpm exec wrangler deploy --config wrangler.production.jsonc

echo "Done. Set GITHUB_TOKEN, GITHUB_WEBHOOK_SECRET, SKILLIST_ADMIN_USER_IDS via pnpm setup:secrets"
