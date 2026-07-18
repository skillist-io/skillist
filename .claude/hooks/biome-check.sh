#!/usr/bin/env bash
# PostToolUse hook (Edit|Write|MultiEdit): auto-format/lint-fix the edited file with Biome,
# mirroring the lefthook pre-commit gate. Silent on success; never blocks the turn.
set -euo pipefail

input=$(cat)
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
[ -z "$file" ] && exit 0

# Only touch file types Biome handles.
case "$file" in
  *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.json | *.jsonc | *.css) ;;
  *) exit 0 ;;
esac

# Skip generated / ignored paths (Biome ignores them too, but avoid the spawn).
case "$file" in
  */routeTree.gen.ts | */packages/db/drizzle/* | */dist/* | */.wrangler/* | */.turbo/*) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}"
# --write applies safe fixes; --no-errors-on-unmatched keeps ignored files quiet.
pnpm exec biome check --write --no-errors-on-unmatched "$file" >/dev/null 2>&1 || true
exit 0
