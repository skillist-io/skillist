# Claude Code configuration for Skillist

This directory tailors Claude Code to the Skillist monorepo: specialized subagents, on-demand skills, deterministic hooks, and path-scoped rules. Everything here is committed so the whole team (and CI) shares it. Per-area conventions live in nested `CLAUDE.md` files next to the code they describe.

## Layout

```
.claude/
  settings.json            # hooks wiring, Read deny rules, worktree config (committed)
  settings.local.json      # personal permission allowlist (gitignored, pre-existing)
  hooks/
    protect-paths.sh        # PreToolUse (Edit/Write): block edits to generated files & secrets
    bash-guard.sh           # PreToolUse (Bash): block shell writes/commits of those files; nudge pnpm lint→check
    biome-check.sh          # PostToolUse: auto `biome check --write` on edited files
    schema-reminder.sh      # PostToolUse: after schema.ts edits, remind of the db:generate/migrate flow
    docs-drift.sh           # PostToolUse: when a doc source-of-truth file changes, name the stale docs
    session-context.sh      # SessionStart: inject repo gates & gotchas
  agents/                   # project subagents (see below)
  skills/                   # on-demand skills, invocable as /<name>
  rules/                    # path-scoped rules (auto-load for matching files)
apps/api/CLAUDE.md          # Worker conventions (loads when working in apps/api)
apps/web/CLAUDE.md          # SPA + design-system conventions
packages/db/CLAUDE.md       # schema change flow
```

## Subagents (`.claude/agents/`)

| Agent | Model | Use for |
| :-- | :-- | :-- |
| `api-route-builder` | inherit | Add/modify `apps/api` endpoints (createRoute + OpenAPIHono, apex regex) |
| `db-migrator` | inherit | Schema changes + Drizzle generate/migrate (project memory) |
| `worker-reviewer` | sonnet | Read-only Workers correctness review (project memory) |
| `web-ui-builder` | inherit | React UI honoring the DESIGN.md system + WCAG 2.2 AA |
| `test-runner` | haiku | Run checks/tests, return a compact summary (keeps logs out of main context) |
| `skill-format-expert` | inherit | `packages/skill-format` + `@skillist/cli` (agentskills.io format) |
| `mcp-tool-dev` | inherit | Registry MCP server tools (`apps/api/src/mcp/`) |
| `github-sync-specialist` | inherit | GitHub mirror-sync pipeline + sync workflow (project memory) |
| `docs-writer` | inherit | Public (apps/docs) + internal docs; accuracy-first, audience-aware |

Invoke by asking ("use the worker-reviewer agent…") or `@`-mention. `db-migrator`, `worker-reviewer`, and `github-sync-specialist` accumulate project memory under `.claude/agent-memory/`.

## Skills (`.claude/skills/`)

| Skill | Auto-loads on | Purpose |
| :-- | :-- | :-- |
| `/add-api-route` | `apps/api/src/routes/**` | Procedure for a new Worker endpoint |
| `/db-change` | `packages/db/src/schema.ts` | Schema change flow |
| `/add-mcp-tool` | `apps/api/src/mcp/**` | Add a registry MCP tool |
| `/new-skill-bundle` | `examples/skills/**` | Scaffold an agentskills.io bundle |
| `/publish-path` | KV/R2/publish/delivery files | Hot-path & realtime reference |
| `/design-system` | `apps/web/**`, `apps/docs/**` | "Control Surface" visual system + a11y |
| `/docs-sync` | `apps/docs/**`, published READMEs | Audit docs for drift vs. code; public/internal placement |
| `/deploy` | — | Deploy/release flow & guardrails |
| `/preflight` | manual only | Run CI gates (`check → typecheck → test`) |
| `/commit` | manual only | Conventional commit (pre-approved git tools) |

## Hooks (deterministic, in `settings.json`)

- **PreToolUse / Edit·Write·MultiEdit** → `protect-paths.sh`: blocks writes to `routeTree.gen.ts`, `packages/db/drizzle/**`, and secrets (`.dev.vars`, `.env`, `wrangler.local.jsonc`); allows `*.example`.
- **PreToolUse / Bash** → `bash-guard.sh`: blocks shell redirects/`sed -i`/`cp`/`mv` into those files and `git add`/`commit` of secrets; nudges `pnpm lint` → `pnpm check`.
- **PostToolUse / Edit·Write·MultiEdit** → `biome-check.sh` (formats edited file) + `schema-reminder.sh` (prompts the migration flow after schema edits) + `docs-drift.sh` (when a doc source-of-truth file changes — routes, CLI, MCP tools, skill-format schema, contracts, setup — names the hand-authored docs that may now be stale).
- **SessionStart** → `session-context.sh`: injects the repo's gates and gotchas.

Hooks require `jq` and `pnpm` on PATH.

## Rules (`.claude/rules/`, path-scoped)

- `generated-files.md` — never hand-edit `routeTree.gen.ts` / `packages/db/drizzle/**`.
- `secrets.md` — never read/edit/commit `.dev.vars` / `.env` / `wrangler.local.jsonc`.

## Worktree config

`settings.json` sets `worktree.sparsePaths` (`.claude`, `apps/*`, `packages`) + `symlinkDirectories: [node_modules]`, so subagents run with `isolation: worktree` get a lightweight checkout that still includes the source-consumed packages (`db`, `contracts`, `auth`).

## Notes

- Lint/format gate is **`pnpm check`** (Biome), not `pnpm lint`. CI runs `check → typecheck → test → playwright → build`.
- Nested `CLAUDE.md` files load on demand — start Claude from a package dir to scope context to it.
- Git hooks (formatting on commit) are handled separately by **lefthook** (`lefthook.yml`); these Claude hooks complement, not replace, them.
- After adding files to `.claude/agents/` or `.claude/skills/` in a running session, **restart Claude Code** so it picks up the new scope directories.
