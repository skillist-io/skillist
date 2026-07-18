#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEV_VARS="$ROOT/apps/api/.dev.vars"
ENV_FILE="$ROOT/.env"

put_local() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=" "$DEV_VARS" 2>/dev/null; then
    perl -i -pe "s|^${key}=.*|${key}=${value}|" "$DEV_VARS"
  else
    echo "${key}=${value}" >> "$DEV_VARS"
  fi
  if [[ -f "$ENV_FILE" ]] && grep -qE "^${key}=" "$ENV_FILE"; then
    perl -i -pe "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  fi
}

cat <<'EOF'
Skillist OAuth setup
====================

1) GitHub OAuth App — https://github.com/settings/applications/new
   Homepage:  https://skillist.io
   Callback:  https://api.skillist.io/api/auth/callback/github
   Local:     http://localhost:8787/api/auth/callback/github

2) Google OAuth client — add redirect URIs to your client:
   https://api.skillist.io/api/auth/callback/google
   http://localhost:8787/api/auth/callback/google

   Edit client:
   https://console.cloud.google.com/auth/clients/18892623702-71jhukk3defecsbtiqhjkfaj1fb1q5qn.apps.googleusercontent.com?project=studied-jigsaw-274214

EOF

if [[ -n "${GITHUB_CLIENT_ID:-}" && -n "${GITHUB_CLIENT_SECRET:-}" ]]; then
  put_local GITHUB_CLIENT_ID "$GITHUB_CLIENT_ID"
  put_local GITHUB_CLIENT_SECRET "$GITHUB_CLIENT_SECRET"
  echo "Wrote GitHub credentials to apps/api/.dev.vars"
fi

if [[ -n "${GOOGLE_CLIENT_ID:-}" && -n "${GOOGLE_CLIENT_SECRET:-}" ]]; then
  put_local GOOGLE_CLIENT_ID "$GOOGLE_CLIENT_ID"
  put_local GOOGLE_CLIENT_SECRET "$GOOGLE_CLIENT_SECRET"
  echo "Wrote Google credentials to apps/api/.dev.vars"
fi

if command -v open >/dev/null 2>&1; then
  open "https://github.com/settings/applications/new" || true
  open "https://console.cloud.google.com/auth/clients/18892623702-71jhukk3defecsbtiqhjkfaj1fb1q5qn.apps.googleusercontent.com?project=studied-jigsaw-274214" || true
fi

if grep -qE '^(GOOGLE_CLIENT_ID|GITHUB_CLIENT_ID)=' "$DEV_VARS"; then
  echo "Pushing configured secrets to production..."
  "$ROOT/scripts/setup-production-secrets.sh"
  echo "Redeploying API so OAuth providers pick up new secrets..."
  (cd "$ROOT/apps/api" && pnpm exec wrangler deploy --config wrangler.production.jsonc)
fi

if ! grep -qE '^GITHUB_CLIENT_ID=.' "$DEV_VARS"; then
  echo ""
  echo "After creating the GitHub OAuth app, run:"
  echo "  GITHUB_CLIENT_ID=... GITHUB_CLIENT_SECRET=... pnpm setup:oauth"
fi
