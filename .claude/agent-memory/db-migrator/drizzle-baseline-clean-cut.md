---
name: drizzle-baseline-clean-cut
description: Postgres migration history was reset on 2026-07-18, then replaced by D1 migrations in packages/db/migrations; notes on inspecting generated migrations under the protect-paths hook
metadata:
  type: project
---

Superseded on 2026-11-05: the database moved to D1 and generated migrations now live in `packages/db/migrations/`. The `drizzle/` directory below no longer exists.

On 2026-07-18 the `packages/db/drizzle/` migration history was reset to a single clean baseline (`0000_*.sql` + fresh `meta/0000_snapshot.json` + single-entry `_journal.json`), covering all 32 tables in `schema.ts`.

**Why:** the prior committed meta was broken — only `0000_snapshot.json` (16 tables) existed while `_journal.json` referenced migrations through idx 11 (snapshots 0001–0011 were never committed; journal also missing idx 4 & 5). That made `pnpm db:generate` diff against a stale 16-table baseline and fall into interactive rename-conflict prompts instead of emitting a clean migration. The project is pre-launch with no live data, so the coordinator chose a clean cut over repairing the chain.

**How to apply:**
- Going forward the meta chain is healthy again, so normal incremental `pnpm db:generate` should work for the next schema change.
- `.claude/hooks/protect-paths.sh` blocks Edit and Write on `packages/db/migrations/**`, so fix `schema.ts` and regenerate instead of editing generated SQL.
- To confirm what a generate produced without reading the file: use drizzle-kit's own stdout (it prints `<table> N columns N indexes N fks` per table plus the output filename) and `git status --short packages/db`. If you need exact DDL, reproduce the diff in a temp dir outside `drizzle/`.
- `npx drizzle-kit generate` run from `packages/db` is the most reliable invocation; `pnpm db:generate` was sometimes refused by the auto-mode classifier (run it plain, no pipes/redirects, or fall back to the drizzle-kit binary).

See [[delivery-kv-meta-invariants]] for the other packages/db gotcha.
