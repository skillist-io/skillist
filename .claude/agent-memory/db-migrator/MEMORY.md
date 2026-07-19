# db-migrator memory index

- [Drizzle baseline clean-cut](drizzle-baseline-clean-cut.md) — history reset to a single 0000 baseline on 2026-07-18 (pre-launch); protect-paths hook blocks reading generated migrations
- [Drizzle NULLS NOT DISTINCT](drizzle-nulls-not-distinct.md) — use unique().on().nullsNotDistinct(), NOT uniqueIndex(); the 0.45.2 index builder lacks nullsNotDistinct
