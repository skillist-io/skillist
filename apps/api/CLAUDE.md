# apps/api — Cloudflare Worker (@skillist/api)

Single Worker entry: `src/index.ts` exports the Hono `fetch` handler **plus** a `queue` consumer, a `scheduled` handler, and the Durable Object / container / workflow classes wrangler needs (`SkillRealtimeHub`, `Sandbox`, `SandboxHeavy`, `SyncSourceWorkflow`).

## Two URL surfaces

- **`/v1/*`** — versioned OpenAPI API, wrapped with `rateLimit()` + `authMiddleware`. Route modules in `src/routes/` are mounted via `v1.route("/", ...)`.
- **Apex GitHub-style paths** — `/{org}/{repo}/SKILL.md|meta|bundle|scripts|run|runs`, mounted at root. Delivery reads (`SKILL.md`/`meta`/`bundle`) are **public**; execution (`scripts`/`run`/`runs`) is authed by an **inline path-regex** in `index.ts`. That regex is mirrored in `apps/web/vite.config.ts`. **When you add/rename an apex path, update both regexes.**

## Rules

- New endpoints use `createRoute` + `OpenAPIHono` so they appear in `/openapi.json` and `/docs`. Reuse Zod schemas from `@skillist/contracts`. Canonical example: `src/routes/skills.ts`. → skill: `/add-api-route`, agent: `api-route-builder`.
- **DB only via the `HYPERDRIVE` binding** — `createWorkerDb(env)` (`src/lib/db.ts`). Never a raw connection string. Gate org resources with `requireOrgAccess(...)`.
- **Hot delivery path reads KV** (`lib/kv.ts`/`lib/delivery.ts`), bundles from **R2** (`lib/r2.ts`); publish writes KV + R2 and broadcasts via `SkillRealtimeHub`. Don't put DB reads on the delivery path. → skill: `/publish-path`.
- Queue consumer handles `skillist-ai-jobs` (`lib/ai.ts`, `lib/eval.ts`) and `skillist-sync-jobs` (`lib/github-sync/`); ack/retry per message.
- Skill execution runs untrusted scripts in Sandbox containers; heavy skills → `SandboxHeavy`. Quotas/access: `lib/run-quota.ts`, `lib/skill-execution-access.ts`.
- Secrets are Worker secrets in `.dev.vars` (local) — never in `vars` or committed. Env type is hand-maintained in `src/env.ts`.

## Commands

- Dev: `pnpm dev:api` (:8787, merges `wrangler.jsonc` + gitignored `wrangler.local.jsonc`). Build: `wrangler deploy --dry-run` (via `pnpm build`).
- Tests run under `@cloudflare/vitest-pool-workers`. One file: `pnpm --filter @skillist/api exec vitest run <path>`.
- **DB-dependent tests** (org RBAC, agent memory, account deletion, telemetry attribution) need a real Postgres, because anything behind `authMiddleware` opens a connection per request. Without one they **skip** — the suite still passes, so check the skip count before trusting a green run. `TEST_DATABASE_URL` is declared in `turbo.json`'s `test` task; without that declaration turbo filters it out and the suites skip even when a database is running. With a database, all 248 run:
  ```bash
  NEON_PROJECT_ID=<id> pnpm db:up && pnpm db:migrate:local     # ephemeral Neon branch
  TEST_DATABASE_URL="postgresql://neon:npg@localhost:5432/neondb?sslmode=no-verify" pnpm test
  NEON_PROJECT_ID=<id> pnpm db:down                            # deletes the branch
  ```
  `vitest.config.ts` turns `TEST_DATABASE_URL` into the Hyperdrive local connection string plus the `INTEGRATION_DB` binding the suites gate on. CI uses a `postgres:17` service container the same way. Gate new suites with `describe.skipIf(!hasTestDb)` from `src/test-support/db.ts`, which also has `seedUser`/`seedOrg`/`cleanup`.
- CI deploys with `wrangler deploy --config wrangler.production.jsonc`.

For Workers correctness review, use the `worker-reviewer` agent.
