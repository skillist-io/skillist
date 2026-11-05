#!/usr/bin/env bash
set -euo pipefail

# One-time, AFTER the skillist.dev deploy is live: 301 every legacy skillist.io
# host to its skillist.dev twin, keeping path and query.
#
# api.skillist.io is excluded on purpose — it keeps serving directly, because
# published CLIs and GitHub webhooks send authenticated requests and POSTs that
# a redirect would break. See the routes comment in
# apps/api/wrangler.production.jsonc.
#
# Running this before skillist.dev is live redirects real traffic to nothing,
# so it refuses unless the new hosts answer. This replaces the zone's whole
# http_request_dynamic_redirect phase; the zone has no other redirect rules.
#
# One literal rule per host: plain equality and concat() need no paid-plan
# rule features, and the zone is on Free.
#
# Usage: CLOUDFLARE_API_TOKEN=... ./scripts/setup-legacy-redirect.sh

ZONE_ID="dc6baf8f846788eceefa5a2534c43b7c" # skillist.io

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN (Zone > Single Redirect > Edit)}"

for url in https://skillist.dev https://console.skillist.dev https://docs.skillist.dev https://api.skillist.dev/health; do
  code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$url")
  if [ "$code" != "200" ]; then
    echo "Refusing: $url returned $code. Deploy skillist.dev first." >&2
    exit 1
  fi
done

curl -sS --fail-with-body -X PUT \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/phases/http_request_dynamic_redirect/entrypoint" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data @- <<'JSON'
{
  "rules": [
    {
      "description": "skillist.io to skillist.dev",
      "expression": "http.host eq \"skillist.io\"",
      "action": "redirect",
      "action_parameters": {
        "from_value": {
          "status_code": 301,
          "preserve_query_string": true,
          "target_url": {
            "expression": "concat(\"https://skillist.dev\", http.request.uri.path)"
          }
        }
      }
    },
    {
      "description": "console.skillist.io to console.skillist.dev",
      "expression": "http.host eq \"console.skillist.io\"",
      "action": "redirect",
      "action_parameters": {
        "from_value": {
          "status_code": 301,
          "preserve_query_string": true,
          "target_url": {
            "expression": "concat(\"https://console.skillist.dev\", http.request.uri.path)"
          }
        }
      }
    },
    {
      "description": "docs.skillist.io to docs.skillist.dev",
      "expression": "http.host eq \"docs.skillist.io\"",
      "action": "redirect",
      "action_parameters": {
        "from_value": {
          "status_code": 301,
          "preserve_query_string": true,
          "target_url": {
            "expression": "concat(\"https://docs.skillist.dev\", http.request.uri.path)"
          }
        }
      }
    }
  ]
}
JSON
echo
echo "Done. Verify: curl -sI https://skillist.io/registry | grep -i location"
