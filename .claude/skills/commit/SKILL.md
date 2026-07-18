---
name: commit
description: >-
  Stage and commit the current changes following repo conventions. Manual only.
disable-model-invocation: true
allowed-tools: >-
  Bash(git status:*) Bash(git diff:*) Bash(git add:*) Bash(git commit:*)
  Bash(git log:*) Bash(git branch:*) Bash(git checkout:*) Bash(git rev-parse:*)
argument-hint: "[optional message]"
---

# Commit changes

Requested message intent: `$ARGUMENTS`

Create a clean, conventional commit. **Only commit when the user has asked you to.**

## Steps

1. `git status` and `git diff` (staged + unstaged) to see exactly what will be committed. Review it.
2. **Never stage secrets/local config**: `**/.dev.vars`, `wrangler.local.jsonc`, `.env*`, `tests/e2e/.auth/`. The `bash-guard` hook blocks these, but check anyway.
3. **Branch first if on `main`**: `git rev-parse --abbrev-ref HEAD`; if it's `main`, create a topic branch before committing.
4. Stage intentionally (prefer explicit paths over `git add -A` when the working tree is mixed).
5. Commit with a message matching the repo style — a concise, sentence-case summary line ending in a period (see `git log`, e.g. _"Add binary asset uploads (images, PDFs, archives) via R2."_). End the message with the trailer:

   ```
   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   ```

6. Do **not** push unless asked. If asked to open a PR, end the PR body with:

   ```
   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   ```

## Before committing non-trivial changes

Consider running `/preflight` so you don't commit code that fails CI's gates.
