# packages/db — Drizzle schema + migrations (@skillist/db)

Postgres schema for Skillist, consumed as **source** (`workspace:*`, no build step). Exports `.` and `./schema`.

## Change flow (the only correct one)

1. Edit **`src/schema.ts`** — the single source of truth (~30 `pgTable`s + `pgEnum`s: users/sessions/auth, organizations/orgMembers, skills/skillVersions/skillFiles, feedback/approvals, registryEntries, apiKeys, aiJobs, auditEvents, telemetryEvents, skillEvals, skillRuns, skillSources/provenance, oauth*, etc.).
2. `pnpm db:generate` — drizzle-kit writes SQL to `drizzle/NNNN_*.sql` + `meta/_journal.json`.
3. `pnpm db:migrate` — applies against `DATABASE_URL` from the root `.env`.

→ skill: `/db-change`, agent: `db-migrator`.

## Rules

- 🚫 **Never hand-edit `drizzle/`** — generated and Biome-ignored. Fix `schema.ts` and regenerate.
- Enums shared with the app mirror `@skillist/contracts` — keep them in sync.
- Two clients: the Worker uses `createWorkerDb(env)` over `HYPERDRIVE` (`apps/api/src/lib/db.ts`); migration/seed scripts use `createDb(connectionString)` (`src/index.ts`). Don't mix them.
- Prefer additive, backward-compatible migrations; flag any drop/rename/type-narrow and its data risk before running `db:migrate`.
