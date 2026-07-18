---
name: new-skill-bundle
description: >-
  Scaffold a new agentskills.io skill bundle under examples/skills/ (used by
  seeding, evals, and as validator fixtures). Use when adding a reference skill
  to the registry examples.
paths:
  - examples/skills/**
argument-hint: "[skill-name] [what it does]"
---

# New example skill bundle

Create a valid agentskills.io bundle at `examples/skills/<skill-name>/`.

Skill: `$ARGUMENTS`

## Rules

- The bundle format is validated by `@skillist/skill-format`. `SKILL.md` frontmatter must satisfy `skillFrontmatterSchema`: `name` (lowercase-hyphen, ≤64, matching the directory), `description` (≤1024), optional `license`, `compatibility`, `metadata`, `allowed-tools`.
- Allowed structure: `SKILL.md` at root; optional `scripts/`, `references/`, `assets/` dirs; optional `plugin.json`. Nothing else at the root.
- Study a sibling for the house style: `examples/skills/api-design/`, `git-commit/`, `registry-mcp/`, `security-audit/`, `sql-review/`, `cloudflare-deploy/`. Match their tone and structure.
- These bundles are **fixtures + seed data + eval inputs** — keep them realistic and self-contained. `assets/` are Biome-ignored.

## Steps

1. Create `examples/skills/<skill-name>/SKILL.md` with valid frontmatter and instructions. (`createSkillTemplate` in `@skillist/skill-format` shows the canonical shape.)
2. Add any `scripts/` / `references/` / `assets/` the skill needs.
3. Validate: run the skill-format tests, or `pnpm cli` to lint/review the bundle, or the review action. At minimum confirm `validateSkillBundle` passes.

## Verify

- `pnpm --filter @skillist/skill-format test` (fixtures are exercised here).
- Optionally `pnpm seed:registry` (dev DB) to confirm it seeds, and `pnpm run:public-evals` if it should be an eval target.
- `pnpm check`.
