#!/usr/bin/env bash
# Post-merge mirror sync ops: secrets, queue trigger, delivery verification.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_URL="${SKILLIST_API_URL:-https://api.skillist.dev}"
WEB_URL="${SKILLIST_WEB_URL:-https://skillist.dev}"

echo "==> Mirror sync post-merge ops"
echo "API: $API_URL"
echo "Web: $WEB_URL"

if [[ -f "$ROOT/apps/api/.dev.vars" ]]; then
  echo "==> Pushing mirror-related production secrets (skip if empty)"
  bash "$ROOT/scripts/setup-production-secrets.sh" || true
else
  echo "skip secrets (.dev.vars missing)"
fi

echo "==> Enqueue sync_all via Cloudflare Queue (requires wrangler auth)"
if command -v pnpm >/dev/null; then
  (cd "$ROOT/apps/api" && pnpm exec wrangler queues send skillist-sync-jobs \
    '{"type":"sync_all"}' \
    --config wrangler.production.jsonc) || echo "queue send failed — trigger manually from /admin/mirrors"
fi

echo "==> Verify registry mirror filter"
curl -fsS "$API_URL/v1/registry?sourceType=mirror&pageSize=5" | head -c 400 || echo "registry check failed"
echo ""

echo "==> Sample delivery paths (may 404 until first sync completes)"
for path in cloudflare/agents-sdk anthropics/algorithmic-art; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$WEB_URL/$path/SKILL.md" || echo "000")
  echo "  $WEB_URL/$path/SKILL.md → HTTP $code"
done

echo "==> Register GitHub webhooks (repos your token can admin)"
node "$ROOT/scripts/setup-mirror-webhooks.mjs" || echo "webhook setup skipped/failed"

echo "Done. Monitor Workers → Workflows / Queues for sync progress."
