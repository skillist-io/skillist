---
name: sql-review
description: Review SQL queries and schema changes for performance, safety, and migration correctness.
license: MIT
metadata:
  author: skillist
  category: development
  tags: sql, database, performance
  level: mid
---

# SQL Review

Use when reviewing queries, indexes, or migrations before production.

## When to activate

- New migration or schema change
- Slow query investigation
- Index recommendations

## Procedure

1. Check for missing indexes on filter/join columns.
2. Flag `SELECT *`, unbounded scans, and missing `LIMIT` on exploratory queries.
3. Verify migrations are reversible or document irreversible steps.
4. Prefer parameterized queries; never interpolate user input.
5. Suggest `EXPLAIN` for non-trivial queries.

## Output format

- Findings by severity (blocker, warning, note)
- Suggested index or rewrite
- Migration risk summary
