---
name: db-change
description: >-
  The correct flow for changing the Postgres schema (packages/db, Drizzle):
  edit schema.ts, generate the migration, migrate. Use when adding/altering
  tables, columns, enums, indexes, or relations.
paths:
  - packages/db/src/schema.ts
argument-hint: "[schema change to make]"
---

# Database schema change

Change requested: `$ARGUMENTS`

## The only correct flow

1. **Edit `packages/db/src/schema.ts`** — the single source of truth (~30 `pgTable`s + `pgEnum`s). Match existing naming, enum reuse, `references()` relations, and timestamp conventions. Enums shared with the app mirror `@skillist/contracts` — keep them in sync.
2. **`pnpm db:generate`** — drizzle-kit writes SQL to `packages/db/drizzle/NNNN_*.sql` and updates `meta/_journal.json`.
3. **`pnpm db:migrate`** — applies against `DATABASE_URL` from the root `.env`.

## Rules

- 🚫 **Never hand-edit `packages/db/drizzle/`** — it's generated and Biome-ignored. Wrong SQL? Fix `schema.ts` and regenerate.
- Prefer additive, backward-compatible changes. For any drop/rename/type-narrow, state the data-loss risk before running `db:migrate`.
- After changing a table, grep `apps/api/src` for readers/writers and update contracts + route handlers to match. The Worker reads the schema via `createWorkerDb(env)` over the `HYPERDRIVE` binding.

## Verify

- `pnpm typecheck` (schema and `apps/api` type errors surface here).
- If app code changed: `pnpm --filter @skillist/api exec vitest run <path>`.

For a non-trivial change spanning tables and call sites, delegate to the `db-migrator` agent.
