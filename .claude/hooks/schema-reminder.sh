#!/usr/bin/env bash
# PostToolUse hook (Edit|Write|MultiEdit): after a Drizzle schema edit, remind Claude
# to run the migration flow. additionalContext is fed back to Claude.
set -euo pipefail

input=$(cat)
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')

case "$file" in
  */packages/db/src/schema.ts)
    jq -n '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:"You edited packages/db/src/schema.ts. Next: run `pnpm db:generate` then `pnpm db:migrate`. Do NOT hand-edit packages/db/drizzle/. Also update @skillist/contracts enums and apps/api route handlers that read the changed table."}}'
    ;;
esac
exit 0
