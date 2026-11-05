#!/usr/bin/env bash
set -euo pipefail

# Proves the deploy token can reach everything a deploy touches, before anything
# is uploaded. Read-only, so it changes nothing. See the preflight job in ci.yml.

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"

API="https://api.cloudflare.com/client/v4"
D1_DATABASE_ID="9b901aed-8945-4574-ae3c-65c9430d05c2"
# Zones with routes or custom domains in a wrangler config.
ZONES=("be3a81f9239bae3a725d9ede21c87ecc:skillist.dev" "dc6baf8f846788eceefa5a2534c43b7c:skillist.io")

failed=0
check() {
  local label="$1" path="$2" code
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$API$path")
  if [ "$code" = "200" ]; then
    echo "ok    $label"
  else
    echo "FAIL  $label (HTTP $code)" >&2
    failed=1
  fi
}

check "Workers scripts" "/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts"
check "D1 database" "/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database/$D1_DATABASE_ID"
for zone in "${ZONES[@]}"; do
  check "Worker routes on ${zone#*:}" "/zones/${zone%%:*}/workers/routes"
done

if [ "$failed" -ne 0 ]; then
  echo "The token is missing access above. Nothing was deployed." >&2
  exit 1
fi
