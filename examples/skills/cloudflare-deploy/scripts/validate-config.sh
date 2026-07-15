#!/usr/bin/env bash
# Validate wrangler config has required fields (lightweight JSON check).
set -euo pipefail

CONFIG="${1:-wrangler.jsonc}"
if [ ! -f "$CONFIG" ]; then
  echo "FAIL: missing $CONFIG" >&2
  exit 1
fi

for field in name main compatibility_date; do
  if ! grep -q "\"$field\"" "$CONFIG" && ! grep -q "$field" "$CONFIG"; then
    echo "FAIL: missing field '$field' in $CONFIG" >&2
    exit 1
  fi
done

echo "validate-config=passed"
echo "file=$CONFIG"
