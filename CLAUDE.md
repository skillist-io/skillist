# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Skillist ([skillist.dev](https://skillist.dev)) is a realtime Agent Skills registry — publish, version, improve, and deliver skills compliant with the [agentskills.io](https://agentskills.io) spec. It runs entirely on Cloudflare Workers.

## Monorepo layout

pnpm + Turborepo workspace (`apps/*`, `packages/*`). Node >= 20, pnpm 11.

```
apps/
  api/    Cloudflare Worker — Hono API, Durable Objects, Queue consumer, MCP server (@skillist/api)
  web/    React SPA — Vite, TanStack Router/Query, shadcn/ui, Tailwind v4 (@skillist/web)
  docs/   Astro + Starlight user docs (@skillist/docs)
packages/
  db/            Drizzle schema + migrations (drizzle-kit, Postgres). Exports `.` and `./schema`
  contracts/     Shared Zod schemas / event types used across api + web
  skill-format/  agentskills.io bundle validator, semver, security/review helpers (published to npm)
  cli/           `@skillist/cli` — pull/push skills (published to npm)
  auth/          Better Auth config shared by api + web
  tsconfig/      Shared tsconfig bases
```

`packages/db`, `contracts`, `auth` are consumed as source (`workspace:*`, no build step for `db`/`contracts`); `skill-format` and `cli` are built with `tsc` and published to npm.

## Commands

Run from repo root (Turborepo fans out to workspaces):

```bash
pnpm install
pnpm setup:local          # generates .env, apps/api/.dev.vars, wrangler.local.jsonc
pnpm db:migrate           # drizzle-kit migrate against DATABASE_URL in .env

pnpm dev:api              # Worker on :8787 (also serves /docs API reference + /mcp)
pnpm dev:web              # SPA on :5173
pnpm dev:docs             # docs on :4321

pnpm check                # biome check .  (lint + format — this is what CI runs, NOT `pnpm lint`)
pnpm check:fix            # biome autofix
pnpm typecheck            # tsc across all workspaces
pnpm test                 # turbo test → vitest per workspace
pnpm build                # turbo build (api build = wrangler dry-run into dist/)
```

Testing specifics:
- **Unit tests** live next to source (`*.test.ts`). API tests run under `@cloudflare/vitest-pool-workers` (real Workers runtime), config in `apps/api/vitest.config.ts`.
- Run one workspace: `pnpm --filter @skillist/api test`. Run one file: `pnpm --filter @skillist/api exec vitest run src/publish-latency.test.ts`.
- `pnpm smoke` — HTTP checks against **production** (`tests/vitest.config.ts`); builds the CLI first.
- `pnpm test:e2e` — Playwright against skillist.dev (`tests/e2e/`).
- CI (`.github/workflows/ci.yml`) runs `check → typecheck → test → playwright → build`, then deploys api/web/docs to Cloudflare on `main`.

DB workflow: edit `packages/db/src/schema.ts` → `pnpm db:generate` (writes SQL to `packages/db/drizzle/`) → `pnpm db:migrate`.

## API architecture (apps/api)

`src/index.ts` is the single Worker entry. It exports the fetch handler **and** a `queue` consumer, plus the Durable Object classes (`SkillRealtimeHub`, `Sandbox`, `SandboxHeavy`). Key structural facts:

- **Two URL surfaces.** `/v1/*` is the versioned OpenAPI API (rate-limited + `authMiddleware`, routes in `src/routes/{orgs,skills,registry,feedback,governance,realtime}.ts`). Apex GitHub-style paths (`/{org}/{repo}/SKILL.md|meta|bundle|scripts|run`) are mounted at root via `deliveryRoutes` + `executionRoutes` — delivery reads are **public**, execution paths (`scripts`/`run`/`runs`) get auth via an inline path-regex middleware in `index.ts`. When adding apex routes, update that regex.
- **Hot delivery path.** Published `SKILL.md` and meta are served from **KV** (`SKILLS_KV`) for <10ms edge reads (`lib/kv.ts`, `lib/publish.ts`, `lib/delivery.ts`). Full bundles live in **R2** (`SKILLS_R2`, `lib/r2.ts`). Publishing writes KV + R2 and broadcasts via the DO.
- **Realtime.** `SkillRealtimeHub` DO (one instance per `org:repo`, keyed by `idFromName`) fans out publish events over WebSocket + SSE. Publish flow calls `broadcastPublish` → DO `/broadcast`.
- **Async jobs via Queue.** `AI_QUEUE` (`skillist-ai-jobs`) carries `AiJobMessage` (`type: "feedback" | "eval"`). The `queue()` handler in `index.ts` dispatches to `lib/ai.ts` (AI-drafted skill improvements from approved feedback) and `lib/eval.ts` (skill evals). Uses Worker AI + AI Gateway.
- **Skill execution** runs untrusted skill scripts in Cloudflare Sandbox containers. `lib/skill-runtime.ts` picks a runtime (`local`/`sandbox`/`container`) from the bundle; heavy skills (wrangler/deploy) route to `SandboxHeavy` (`Dockerfile.heavy`), others to `Sandbox` (`Dockerfile`). Quotas/access in `lib/run-quota.ts`, `lib/skill-execution-access.ts`.
- **Auth is Better Auth** (passwordless: OAuth GitHub/Google, magic link, passkeys), configured in `packages/auth` + `lib/api-auth.ts`. Also exposes MCP OAuth discovery (`/.well-known/oauth-*`) and a remote **MCP server** at `/mcp` (`src/mcp/`, registry tools). API-key auth (`sk_...`) for CLI/programmatic writes in `lib/api-auth.ts`.
- **Data:** Neon Postgres reached through **Hyperdrive** (`HYPERDRIVE` binding) — never a direct connection string in the Worker. `createWorkerDb(env)` (`lib/db.ts`) builds the Drizzle client; schema/tables from `@skillist/db/schema`.

### Wrangler configs (apps/api)
- `wrangler.jsonc` — base + local dev bindings. `pnpm dev:api` merges it with gitignored `wrangler.local.jsonc` (real Hyperdrive→Neon). `pnpm setup:local` regenerates the overlay from `DATABASE_URL`.
- `wrangler.production.jsonc` — used by CI deploy (`wrangler deploy --config wrangler.production.jsonc`).
- Secrets (`BETTER_AUTH_SECRET`, OAuth client secrets, AI Gateway token) are Worker secrets, not in vars. `apps/api/.dev.vars` holds them locally; `pnpm setup:secrets` pushes to production.

## Conventions

- **TypeScript 7, Zod 4, Hono 4, ESM everywhere** (`"type": "module"`). Contracts and DB schema are the shared source of truth — prefer importing types from `@skillist/contracts` / `@skillist/db` over redefining.
- **Biome** is the linter/formatter (not ESLint/Prettier): 2-space indent, 100 col, double quotes, semicolons, trailing commas. `noExplicitAny`/`noNonNullAssertion` are warnings; relaxed in `*.test.ts`. `routeTree.gen.ts` and `packages/db/drizzle/` are generated — don't hand-edit.
- New OpenAPI routes use `createRoute` + `OpenAPIHono` so they appear in `/openapi.json` and the Scalar `/docs` page.
- `examples/skills/` holds reference skill bundles used by seeding (`pnpm seed:registry`) and evals (`pnpm run:public-evals`) — they double as validator fixtures.

## Design Context

Frontend strategy lives in `PRODUCT.md` (and `DESIGN.md` for the visual system). Read them before UI work. In brief:

- **Register:** `product` by default (the authenticated tool in `apps/web` is the daily-driver), with the public landing/registry as a co-equal `brand` surface. Keep them visibly one system.
- **Personality:** precise, technical, calm — engineering-grade restraint (Linear / Vercel / Warp composure, not their palettes). Trust + control is the primary outcome.
- **Anti-references:** generic shadcn/AI-default (the current stock grayscale-neutral + Inter + default-purple is the thing to leave behind), playful/consumer/rounded, cluttered enterprise dashboard, loud SaaS marketing.
- **Accessibility:** WCAG 2.2 AA — 4.5:1 body contrast, full keyboard nav + visible focus, light **and** dark themes both pass, reduced-motion alternatives, never color-only status.
- Iterate on UI with the impeccable skill (`/impeccable <command>`); live mode is configured (`.impeccable/live/config.json` → `apps/web/index.html`).
