#!/usr/bin/env bash
# PreToolUse hook (Bash): backstop the Edit/Write protections at the shell level.
# Blocks shell writes to generated/secret files and staging/committing secrets.
set -euo pipefail

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
[ -z "$cmd" ] && exit 0

deny() {
  echo "BLOCKED by .claude/hooks/bash-guard.sh: $1" >&2
  exit 2
}

# 1) Shell writes (redirect / tee / sed -i / cp / mv) into generated or secret files.
if printf '%s' "$cmd" | grep -Eq '(>>?|[[:space:]]tee[[:space:]]|sed[[:space:]]+(-i|--in-place)|(^|[[:space:]])(cp|mv)[[:space:]]).*(routeTree\.gen\.ts|packages/db/drizzle/|\.dev\.vars|wrangler\.local\.jsonc|(^|[[:space:]/])\.env([[:space:]]|$|\.local))'; then
  deny "Command writes to a generated or secret file. Generated code: edit the source (packages/db/src/schema.ts, apps/web/src/routes/) and regenerate. Secrets: edit the committed .example template or run \`pnpm setup:local\`."
fi

# 2) Staging or committing secret / local-config files.
if printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+(add|commit).*(\.dev\.vars|wrangler\.local\.jsonc|(^|[[:space:]/])\.env([[:space:]]|$|\.local))'; then
  deny "Refusing to stage/commit a secret or local-config file (.dev.vars / wrangler.local.jsonc / .env). These are gitignored."
fi

# 3) Soft nudge: CI's lint/format gate is `pnpm check`, not `pnpm lint`.
if printf '%s' "$cmd" | grep -Eq '(^|[[:space:]&|;])pnpm[[:space:]]+lint([[:space:]]|$)'; then
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"Note: CI'"'"'s lint/format gate is `pnpm check` (Biome check), not `pnpm lint`. Use `pnpm check` / `pnpm check:fix`."}}'
  exit 0
fi

exit 0
