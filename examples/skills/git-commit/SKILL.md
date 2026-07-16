---
name: git-commit
description: Write clear conventional commit messages and group related changes into focused commits.
license: MIT
metadata:
  author: skillist
  category: utilities
  tags: git, commits, workflow
  level: minimal
---

# Git Commit

Use when preparing commits or summarizing a changeset for version control.

## When to activate

- User asks to commit changes
- Reviewing staged diff before commit
- Splitting a large diff into logical commits

## Procedure

1. Read the full diff; identify distinct logical changes.
2. Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.
3. Subject line ≤ 72 chars; body explains why, not just what.
4. One concern per commit; avoid mixing unrelated files.
5. Never commit secrets, `.env`, or credentials.

## Output format

```
feat(scope): short subject

Optional body explaining motivation and trade-offs.
```
