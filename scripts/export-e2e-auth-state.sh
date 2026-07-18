#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AUTH_FILE="$ROOT/tests/e2e/.auth/user.json"

if [[ ! -f "$AUTH_FILE" ]]; then
  echo "Missing $AUTH_FILE"
  echo ""
  echo "Generate it by signing in to production, then run:"
  echo "  pnpm exec playwright open --save-storage=$AUTH_FILE https://skillist.io/login"
  echo ""
  echo "Complete GitHub/Google sign-in in the browser, then close it."
  exit 1
fi

echo "Base64 auth state (add as GitHub secret E2E_AUTH_STATE_B64):"
base64 < "$AUTH_FILE" | tr -d '\n'
echo
