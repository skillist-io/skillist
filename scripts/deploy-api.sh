#!/usr/bin/env bash
set -euo pipefail

echo "==> Deploying Skillist API to Cloudflare Workers"
cd "$(dirname "$0")/../apps/api"

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -z "${WRANGLER_SEND_METRICS:-}" ]; then
  echo "Ensure you are logged in: wrangler login"
fi

wrangler deploy --config wrangler.production.jsonc

echo "==> Done. Configure custom domains:"
echo "    api.skillist.io -> skillist-api"
echo "    Enable Email Sending: wrangler email sending enable skillist.io"
