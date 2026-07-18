#!/usr/bin/env bash
set -euo pipefail

# One-time bootstrap deploy for the skillist.dev -> skillist.io cut-over.
# Deploys api + web + docs to Cloudflare so the new domain goes live, then
# health-checks it. Idempotent — safe to re-run.
#
# PREREQUISITES (see the cut-over runbook / PR):
#   1. DB migration already applied: api_keys.expires_at/revoked_at columns and
#      the pg_trgm trigram indexes. Deploying the code BEFORE migrating breaks
#      API-key auth (the auth path selects the new columns).
#   2. skillist.io is a zone in your Cloudflare account.
#   3. wrangler is authenticated: `wrangler login`, or CLOUDFLARE_API_TOKEN set.
#
# Usage:
#   ./scripts/bootstrap-deploy-io.sh          # prompts to confirm the migration ran
#   YES=1 ./scripts/bootstrap-deploy-io.sh    # skip the confirmation prompt

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

# --- Preflight ---------------------------------------------------------------
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  step "Cloudflare auth"
  echo "CLOUDFLARE_API_TOKEN not set — relying on \`wrangler login\`. Ctrl-C if not logged in."
fi

if [ "${YES:-0}" != "1" ]; then
  step "Confirm prerequisite"
  echo "Deploying this code BEFORE the DB migration will break API-key auth"
  echo "(auth selects api_keys.expires_at / revoked_at)."
  read -r -p "Has \`pnpm db:migrate\` (api-key columns + pg_trgm) run against prod? [y/N] " ans
  case "$ans" in
    y | Y | yes | YES) ;;
    *)
      echo "Aborting. Run the migration first, then re-run this script."
      exit 1
      ;;
  esac
fi

# --- Deploy ------------------------------------------------------------------
# wrangler is a workspace dependency, not global — invoke via `pnpm exec`.
step "Deploying API (api.skillist.io + skillist.io/api|v1 routes)"
(cd apps/api && pnpm exec wrangler deploy --config wrangler.production.jsonc)

step "Building web (VITE_API_URL from apps/web/.env.production) + deploying (skillist.io)"
pnpm --filter @skillist/web build
(cd apps/web && pnpm exec wrangler deploy)

step "Building docs + deploying (docs.skillist.io)"
pnpm --filter @skillist/docs build
(cd apps/docs && pnpm exec wrangler deploy)

# --- Health check ------------------------------------------------------------
step "Health checks (custom domains can take a minute to provision)"
check() {
  local name="$1" url="$2" want="$3" code tries=0
  until [ "$tries" -ge 10 ]; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" || echo 000)"
    if [ "$code" = "$want" ]; then
      printf '  \342\234\223 %-12s %s (%s)\n' "$name" "$url" "$code"
      return 0
    fi
    tries=$((tries + 1))
    sleep 6
  done
  printf '  \342\234\227 %-12s %s (last: %s) — may still be provisioning\n' "$name" "$url" "$code"
  return 1
}

rc=0
check "API health" "https://api.skillist.io/health" 200 || rc=1
check "Web app" "https://skillist.io/" 200 || rc=1
check "Docs" "https://docs.skillist.io/" 200 || rc=1

step "Next steps"
cat <<'NEXT'
  1. Re-run CI on the PR — the e2e now resolves skillist.io and should pass.
  2. Merge to main; the CI deploy re-runs idempotently.
  3. Manual smoke: one Google + one GitHub sign-in, and a magic-link email
     (from welcome@skillist.io), per the post-deploy runbook.
NEXT

exit "$rc"
