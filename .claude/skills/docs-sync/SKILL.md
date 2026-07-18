---
name: docs-sync
description: >-
  Audit documentation for drift against the code that is its source of truth, and
  keep public (apps/docs) vs internal (READMEs/CLAUDE.md) content correctly placed.
  Use when reviewing/updating docs, after changing routes/CLI/MCP tools/schemas, or
  to check whether docs are still accurate. Invoke with /docs-sync.
paths:
  - apps/docs/**
  - packages/cli/README.md
  - packages/skill-format/README.md
argument-hint: "[optional area: api | cli | mcp | skill-format | contracts | all]"
---

# Docs sync — keep docs accurate & correctly placed

Scope: `$ARGUMENTS` (default: `all`).

Skillist docs are **hand-authored** — nothing is generated from the OpenAPI spec, `@skillist/contracts`, or the DB schema. So docs drift silently whenever code changes. This skill audits docs against their source of truth, flags/fixes drift, and checks that each fact sits in the right audience bucket.

For substantial rewrites, delegate to the `docs-writer` agent (it preloads this skill).

## 1. Audience placement (public vs internal)

- **Public** (external users): `apps/docs/src/content/docs/**` → docs.skillist.dev; `packages/cli/README.md`, `packages/skill-format/README.md` (npm). Task-oriented; no roadmap/architecture/secrets/unreleased features.
- **Internal** (contributors/agents): root `README.md`, `PRODUCT.md`, `DESIGN.md`, all `CLAUDE.md`, `apps/docs/AGENTS.md`, `.claude/README.md`. Architecture, rationale, gotchas.

Flag any leak: internal-only detail (DO internals, queue semantics, apex auth regex, admin ids) that has crept into public docs, or user-facing how-tos stranded in a README.

## 2. Drift audit — compare each doc against its source of truth

Read the source **first**, then check the doc matches. Report every mismatch as `doc:line → source:line — what's stale`.

| Area | Public doc(s) to check | Source of truth |
| :-- | :-- | :-- |
| REST `/v1` routes | `platform/registry.mdx`, `platform/delivery.mdx`, `platform/sandbox.mdx`, `src/components/docs/EndpointsTable.tsx` | `apps/api/src/routes/*.ts`; canonical: built `/openapi.json` |
| Apex paths `/{org}/{repo}/…` | `platform/delivery.mdx`, `getting-started/*` | `apps/api/src/routes/delivery.ts`, `execution.ts` |
| MCP tools | `mcp/tools.mdx`, `mcp/index.mdx`, `mcp/connect.mdx` | `apps/api/src/mcp/registry-server.ts` → `REGISTRY_MCP_TOOLS` (+ `mcpServerInfo`) |
| CLI commands / flags | `getting-started/cli.mdx`, `getting-started/quick-start.mdx`, `packages/cli/README.md` | `packages/cli/src/index.ts` `usage()` (+ `inventory.ts`, `source.ts`, `review.ts`) |
| SKILL.md frontmatter | *(no dedicated page — gap)*, `packages/skill-format/README.md` | `packages/skill-format/src/index.ts` → `skillFrontmatterSchema` |
| Roles/scopes/visibility/policies | `platform/authentication.mdx`, `platform/install-policy.mdx` | `packages/contracts/src/index.ts` |
| Env vars / setup | `getting-started/cli.mdx`, root `README.md` | `packages/cli/src/index.ts` env consts, `scripts/setup-local.sh`, `.env.example` |

The CLI surface has **three parallel hand-maintained copies** — `usage()`, `packages/cli/README.md`, `getting-started/cli.mdx`. When one changes, reconcile all three.

## 3. Structural checks (apps/docs)

- **Sidebar vs files**: every `.mdx` under `src/content/docs/**` should be reachable from the `sidebar[]` in `apps/docs/astro.config.mjs`, and every sidebar `slug` must point to a file that exists. List pages missing from the sidebar and slugs pointing at deleted pages.
  ```bash
  # pages on disk vs slugs referenced in the sidebar config
  find apps/docs/src/content/docs -name '*.mdx' | sed 's|.*/content/docs/||;s|\.mdx$||'
  grep -n "slug:" apps/docs/astro.config.mjs
  ```
- Frontmatter: every page has `title` + `description`. Sidebar label ≈ page title (flag confusing divergences).
- Internal links resolve; API-reference links point at `https://api.skillist.dev/docs` (don't duplicate the full spec).

## 4. Coverage gaps

Note documented-in-code-but-not-in-docs concepts. Known gap: **no SKILL.md / bundle-format authoring page** despite `skillFrontmatterSchema` being core — recommend adding one (and registering it in the sidebar).

## 5. Fix or report, then verify

- Fix clear factual drift directly (match the code). For ambiguous/product decisions, report and ask.
- Verify: `pnpm --filter @skillist/docs typecheck` (`astro sync && tsc --noEmit`) → `pnpm --filter @skillist/docs build` → `pnpm check`. Run `pnpm dev:docs` for anything navigational.

Output a short report: drift found (with `doc → source` refs), misplaced content, sidebar/link issues, coverage gaps, and what you changed vs. what needs a human decision.
