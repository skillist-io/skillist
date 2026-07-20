#!/usr/bin/env bash
set -euo pipefail

# Provision the `skillist-failures` Vectorize index and its REQUIRED metadata
# indexes. Idempotent — safe to re-run; "already exists" is treated as success.
#
# Why this exists: the index + metadata indexes are account-level infra, NOT in
# wrangler config, so a fresh Vectorize index (disaster recovery, a new env)
# would come up WITHOUT them. Metadata filters are only enforced when an index
# exists on the property, so a missing `skillId` index silently breaks per-skill
# (per-tenant) isolation on the failure-mining path. Run this BEFORE any vectors
# are written — metadata indexes only cover vectors inserted after they exist.
#
# Usage: bash scripts/provision-vectorize.sh
#   Targets whatever account `wrangler` is authenticated against.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apps/api"

INDEX="skillist-failures"

# Run a wrangler command, tolerating the "already exists" case so re-runs no-op.
provision() {
  local desc="$1"
  shift
  echo "→ $desc"
  if out=$(pnpm exec wrangler "$@" 2>&1); then
    echo "  ok"
  elif echo "$out" | grep -qiE "already exists|duplicate"; then
    echo "  already exists — skipping"
  else
    echo "$out"
    exit 1
  fi
}

provision "create index $INDEX (768-dim cosine)" \
  vectorize create "$INDEX" --dimensions=768 --metric=cosine
provision "metadata index: kind (doc vs failure discriminator)" \
  vectorize create-metadata-index "$INDEX" --property-name=kind --type=string
provision "metadata index: skillId (per-skill/per-tenant failure scoping)" \
  vectorize create-metadata-index "$INDEX" --property-name=skillId --type=string

echo "Vectorize provisioning complete."
echo "Note: metadata-index creation is async — allow a few seconds before seeding."
