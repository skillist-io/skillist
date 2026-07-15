#!/usr/bin/env bash
# Preflight checks before a Cloudflare Workers deploy.
set -euo pipefail

echo "=== Cloudflare deploy preflight ==="

if ! command -v wrangler >/dev/null 2>&1; then
  echo "FAIL: wrangler CLI not found. Install: pnpm add -D wrangler" >&2
  exit 1
fi

WRANGLER_VERSION=$(wrangler --version 2>/dev/null || echo "unknown")
echo "wrangler=$WRANGLER_VERSION"

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ ! -f "$HOME/.wrangler/config/default.toml" ]; then
  echo "WARN: No CLOUDFLARE_API_TOKEN and no wrangler login config detected"
else
  echo "auth=ok"
fi

CONFIG="${1:-wrangler.jsonc}"
if [ ! -f "$CONFIG" ]; then
  echo "FAIL: Config not found: $CONFIG" >&2
  exit 1
fi
echo "config=$CONFIG"
echo "preflight=passed"
