#!/usr/bin/env bash
# PostToolUse hook (Edit|Write|MultiEdit): when a doc source-of-truth file changes,
# remind Claude which hand-authored docs may now be stale. Docs are NOT generated
# from code, so drift is silent. additionalContext is fed back to Claude.
set -euo pipefail

input=$(cat)
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
[ -z "$file" ] && exit 0

msg=""
case "$file" in
  */apps/api/src/mcp/registry-server.ts)
    msg="MCP server changed. If REGISTRY_MCP_TOOLS or mcpServerInfo changed, update the hand-authored apps/docs/src/content/docs/mcp/tools.mdx (and mcp/index.mdx, mcp/connect.mdx). Run /docs-sync." ;;
  */apps/api/src/routes/*.ts)
    msg="A route file changed. Docs prose is NOT generated from OpenAPI — if an endpoint/apex path was added/renamed/removed or its shape changed, update apps/docs/src/content/docs/platform/{registry,delivery,sandbox}.mdx and src/components/docs/EndpointsTable.tsx. Run /docs-sync." ;;
  */packages/cli/src/index.ts)
    msg="CLI usage() may have changed. Reconcile the three parallel copies: apps/docs/src/content/docs/getting-started/cli.mdx, packages/cli/README.md, and usage() itself. Run /docs-sync cli." ;;
  */packages/cli/src/*.ts)
    msg="A CLI subcommand file changed. If the command surface changed, update apps/docs/src/content/docs/getting-started/cli.mdx and packages/cli/README.md. Run /docs-sync cli." ;;
  */packages/skill-format/src/index.ts)
    msg="skillFrontmatterSchema / bundle format may have changed. Update packages/skill-format/README.md and any docs describing SKILL.md frontmatter. Note: there is currently no dedicated skill-format page in apps/docs — consider adding one. Run /docs-sync skill-format." ;;
  */packages/contracts/src/index.ts)
    msg="Shared enums/schemas changed. If roles/scopes/visibility/policies changed, update apps/docs/src/content/docs/platform/{authentication,install-policy}.mdx. Run /docs-sync contracts." ;;
  */scripts/setup-local.sh | */.env.example | */apps/api/.dev.vars.example)
    msg="Setup/env changed. Check the setup steps and env tables in apps/docs/src/content/docs/getting-started/* and the root README.md stay accurate." ;;
  */apps/docs/src/content/docs/*.mdx)
    msg="Docs page edited. The Starlight sidebar is hand-maintained in apps/docs/astro.config.mjs — if you added/removed/renamed a page or changed its slug, update the sidebar[] array too (pages are NOT auto-registered)." ;;
esac

[ -z "$msg" ] && exit 0
jq -n --arg m "$msg" '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$m}}'
exit 0
