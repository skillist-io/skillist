# packages/db — Drizzle schema + migrations (@skillist/db)

SQLite schema for Cloudflare D1, consumed as **source** (`workspace:*`, no build step). Exports `.` and `./schema`.

## Workflow

1. Edit `src/schema.ts`.
2. `pnpm db:generate` — drizzle-kit writes SQL to `migrations/NNNN_*.sql`.
3. `pnpm db:migrate` — applies to the local D1. CI applies to production before it deploys.

## Rules

- 🚫 **Never hand-edit `migrations/`** — generated and Biome-ignored. Fix `schema.ts` and regenerate.
- 🚫 **Never apply a migration to production by hand.** CI runs it before the deploy.
- A migration must work with the code already deployed: add first, drop or rename in a later change.
- Timestamps are `integer` with `mode: "timestamp_ms"`, booleans `integer` with `mode: "boolean"`, JSON `text` with `mode: "json"`. Callers see `Date`, `boolean` and objects.
- SQLite treats NULLs as distinct in unique indexes, and drizzle-kit can't emit expression indexes. Use a generated column (see `agent_memory.user_scope`).
- `neon-export.ts` is the one-time Neon → D1 export. Delete it once the move is finished.
