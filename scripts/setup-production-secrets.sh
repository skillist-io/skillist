#!/usr/bin/env bash
set -euo pipefail

# Configure Skillist production Worker secrets from apps/api/.dev.vars
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEV_VARS="$ROOT/apps/api/.dev.vars"
API_DIR="$ROOT/apps/api"

if [[ ! -f "$DEV_VARS" ]]; then
  echo "Missing $DEV_VARS — run: pnpm setup:local"
  exit 1
fi

cd "$API_DIR"

put_secret() {
  local name="$1"
  local value
  # Prefer a ${name}_PROD override — .dev.vars may hold dev-only OAuth creds
  # (e.g. a localhost GitHub OAuth app) that must never reach production.
  value="$(grep -E "^${name}_PROD=" "$DEV_VARS" | cut -d= -f2- || true)"
  if [[ -z "$value" ]]; then
    value="$(grep -E "^${name}=" "$DEV_VARS" | cut -d= -f2- || true)"
  fi
  if [[ -z "$value" ]]; then
    echo "skip $name (empty in .dev.vars)"
    return 0
  fi
  printf '%s' "$value" | pnpm exec wrangler secret put "$name" --config wrangler.production.jsonc
  echo "set $name"
}

put_secret BETTER_AUTH_SECRET
put_secret GITHUB_CLIENT_ID
put_secret GITHUB_CLIENT_SECRET
put_secret GOOGLE_CLIENT_ID
put_secret GOOGLE_CLIENT_SECRET
put_secret AI_GATEWAY_ACCOUNT_ID
put_secret AI_GATEWAY_TOKEN
put_secret GITHUB_TOKEN
put_secret GITHUB_WEBHOOK_SECRET
put_secret SKILLIST_ADMIN_USER_IDS

echo "Production secrets updated."
