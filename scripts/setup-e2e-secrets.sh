#!/usr/bin/env bash
set -euo pipefail

# Push Playwright auth state and optional API key to GitHub Actions secrets.
#
# 1. Generate auth state (one-time, interactive):
#      pnpm exec playwright open --save-storage=tests/e2e/.auth/user.json https://skillist.dev/login
# 2. Export secrets:
#      ./scripts/setup-e2e-secrets.sh
#    Or with API key:
#      SKILLIST_E2E_API_KEY=sk_... ./scripts/setup-e2e-secrets.sh

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AUTH_FILE="$ROOT/tests/e2e/.auth/user.json"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required — install from https://cli.github.com/"
  exit 1
fi

if [[ ! -f "$AUTH_FILE" ]]; then
  echo "Missing $AUTH_FILE"
  echo ""
  echo "Sign in to production, then re-run:"
  echo "  pnpm exec playwright open --save-storage=$AUTH_FILE https://skillist.dev/login"
  exit 1
fi

echo "Validating auth state against production..."
if ! "$ROOT/scripts/validate-e2e-auth.sh"; then
  echo ""
  echo "Auth state is missing or expired. Sign in again:"
  echo "  pnpm exec playwright open --save-storage=$AUTH_FILE https://skillist.dev/login"
  exit 1
fi

echo "Setting E2E_AUTH_STATE_B64..."
base64 < "$AUTH_FILE" | tr -d '\n' | gh secret set E2E_AUTH_STATE_B64
echo "✓ E2E_AUTH_STATE_B64"

if [[ -n "${SKILLIST_E2E_API_KEY:-}" ]]; then
  echo "Setting SKILLIST_E2E_API_KEY..."
  gh secret set SKILLIST_E2E_API_KEY --body "$SKILLIST_E2E_API_KEY"
  echo "✓ SKILLIST_E2E_API_KEY"
else
  echo ""
  echo "Skip SKILLIST_E2E_API_KEY (unset). To enable authenticated CLI smoke in CI:"
  echo "  SKILLIST_E2E_API_KEY=sk_... $0"
fi

echo ""
echo "Done. CI will run signed-in e2e when the next workflow uses these secrets."
