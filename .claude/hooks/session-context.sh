#!/usr/bin/env bash
# SessionStart hook: inject a short, always-true orientation for this repo.
# stdout from a SessionStart hook is added to Claude's context before the first prompt.
cat <<'EOF'
Skillist orientation (injected by .claude/hooks/session-context.sh):
- Gates (what CI runs): `pnpm check` (Biome — NOT `pnpm lint`) -> `pnpm typecheck` -> `pnpm test`. Run these before declaring work done.
- DB change flow: edit packages/db/src/schema.ts -> `pnpm db:generate` -> `pnpm db:migrate`. Never hand-edit packages/db/drizzle/.
- Never hand-edit apps/web/src/routeTree.gen.ts (TanStack Router generated).
- API tests use @cloudflare/vitest-pool-workers. Single file: `pnpm --filter @skillist/api exec vitest run <path>`.
- New /v1 endpoints use createRoute + OpenAPIHono (so they appear in /openapi.json + /docs). Adding an apex /{org}/{repo}/... path? Update the auth path-regex in BOTH apps/api/src/index.ts and apps/web/vite.config.ts.
- Never commit secrets: **/.dev.vars, wrangler.local.jsonc, .env. Runtime DB access is always via the HYPERDRIVE binding, never a raw connection string.
- UI follows DESIGN.md: squared geometry (0 radius), monochrome ink + exactly two accents (destructive red, signal violet), WCAG 2.2 AA in light and dark.
- Specialized agents available: api-route-builder, db-migrator, worker-reviewer, web-ui-builder, test-runner, skill-format-expert. Skills: /add-api-route, /db-change, /preflight, /publish-path.
EOF
exit 0
