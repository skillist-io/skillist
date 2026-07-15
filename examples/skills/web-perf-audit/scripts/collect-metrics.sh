#!/usr/bin/env bash
# Collect basic timing metrics for a URL (read-only).
set -euo pipefail

URL="${1:-}"
if [ -z "$URL" ]; then
  echo "Usage: collect-metrics.sh <url>" >&2
  exit 1
fi

echo "target=$URL"
echo "timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Time to first byte proxy via curl
curl -sS -o /dev/null -w "ttfb_ms=%{time_starttransfer}\ntotal_ms=%{time_total}\nsize_bytes=%{size_download}\n" "$URL"
