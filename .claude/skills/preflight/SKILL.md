---
name: preflight
description: >-
  Run the same gates CI runs — Biome, typecheck, tests — before committing or
  declaring work done. Invoke manually with /preflight.
disable-model-invocation: true
allowed-tools: >-
  Bash(pnpm check) Bash(pnpm check:fix) Bash(pnpm typecheck) Bash(pnpm test)
  Bash(pnpm --filter *) Bash(pnpm exec vitest *)
argument-hint: "[optional workspace filter, e.g. @skillist/api]"
---

# Preflight checks

Run the CI gates locally, in order, and report a concise pass/fail. Scope: `$ARGUMENTS` (empty = whole repo).

1. **`pnpm check`** — Biome lint + format. This is CI's gate (NOT `pnpm lint`). If it fails on formatting, run `pnpm check:fix` and re-run.
2. **`pnpm typecheck`** — `tsc --noEmit` across workspaces.
3. **`pnpm test`** — Vitest per workspace (API under `@cloudflare/vitest-pool-workers`).

If a workspace filter was given, prefer `pnpm --filter <ws> test` and `pnpm --filter <ws> exec vitest run <path>` for speed, but still run repo-wide `pnpm check` + `pnpm typecheck` (they're fast and cross-workspace).

Do **not** run `pnpm smoke` (production) or `pnpm test:e2e` (Playwright) here.

Report:
```
check:     PASS/FAIL
typecheck: PASS/FAIL
test:      PASS/FAIL  (<n passed, m failed>)
```
List each failure with `file:line` and a one-line cause. Stop and surface the first failing gate rather than pushing through.
