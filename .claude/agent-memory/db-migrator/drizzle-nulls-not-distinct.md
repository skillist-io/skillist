---
name: drizzle-nulls-not-distinct
description: how to emit a UNIQUE ... NULLS NOT DISTINCT constraint in packages/db — the drizzle-orm 0.45.2 uniqueIndex builder does NOT support .nullsNotDistinct()
metadata:
  type: project
---

To get `UNIQUE(...) NULLS NOT DISTINCT` (so a NULL column value still dedupes) in `packages/db/src/schema.ts`, you MUST use the table-level **`unique()` constraint builder**, not `uniqueIndex()`.

- `uniqueIndex(name).on(cols).nullsNotDistinct()` → runtime crash at generate time: `(0, import_pg_core.uniqueIndex)(...).on(...).nullsNotDistinct is not a function`. In drizzle-orm 0.45.2 the `IndexBuilder` only has `.concurrently()/.with()/.where()` — no nullsNotDistinct.
- Correct: `unique(name).on(cols).nullsNotDistinct()` (import `unique` from `drizzle-orm/pg-core`). The `UniqueConstraintBuilder` exposes `.nullsNotDistinct()`.
- Emits `CONSTRAINT "<name>" UNIQUE NULLS NOT DISTINCT("a","b","c")` (a constraint, not an index). drizzle-kit's stdout counts it under fks/constraints, so the table's "N indexes" count will NOT include it — that's expected, not a missing index.

**Why:** functionally a unique constraint and a unique index both enforce uniqueness; NULLS NOT DISTINCT is what makes a nullable column participate in dedupe. 0.45.2 only wired nullsNotDistinct into the constraint path.

**How to apply:** any future schema needing a partial-null dedupe (nullable userId/orgId in a composite unique) uses `unique().on().nullsNotDistinct()`. First introduced for `agent_memory` (org-wide vs user-scoped facts). Requires PG15+ (Neon is PG17). See [[drizzle-baseline-clean-cut]] for the migration-history context.
