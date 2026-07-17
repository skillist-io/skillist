#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AUTH_FILE="$ROOT/tests/e2e/.auth/user.json"

if [[ ! -f "$AUTH_FILE" ]]; then
  echo "Missing $AUTH_FILE"
  exit 1
fi

cd "$ROOT"
pnpm exec playwright test \
  --config tests/e2e/playwright.config.ts \
  --project=authenticated \
  tests/e2e/auth-health.spec.ts \
  --reporter=line

echo "✓ Auth state is valid for signed-in e2e"
