# Skillist

Realtime Agent Skills management, improvement, and versioning platform for [skillist.dev](https://skillist.dev).

Built on Cloudflare Workers with Hono, Durable Objects, KV, R2, Worker AI, AI Gateway, Neon Postgres via Hyperdrive, and Better Auth (passwordless). Compliant with the [agentskills.io](https://agentskills.io/home) specification.

## Stack

| Layer | Technology |
|-------|------------|
| API | Hono, zod-openapi, Scalar docs |
| Realtime | Durable Objects (WebSocket + SSE), KV hot path |
| Storage | R2 (bundles), KV (published SKILL.md), Neon + Hyperdrive |
| Auth | Better Auth — OAuth, magic link, passkeys (no passwords) |
| AI | Worker AI + AI Gateway, Queues for async jobs |
| Web | Vite, TanStack Router/Query, shadcn/ui, Tailwind CSS v4 |

## Dependencies

All packages use latest stable versions (updated via `pnpm up -r --latest`). Key versions:

| Package | Version |
|---------|---------|
| TypeScript | 7.x |
| Hono | 4.x |
| Zod | 4.x |
| Better Auth | 1.6.x |
| Wrangler | 4.x |
| TanStack Router | 1.x |
| Tailwind CSS | 4.x |
| Vitest | 4.x |
| pnpm | 11.x |

## OAuth setup

Configure GitHub and Google per [Better Auth docs](https://better-auth.com/docs/authentication/github):

| Provider | Local redirect URI | Production redirect URI |
|----------|-------------------|-------------------------|
| GitHub | `http://localhost:8787/api/auth/callback/github` | `https://api.skillist.dev/api/auth/callback/github` |
| Google | `http://localhost:8787/api/auth/callback/google` | `https://api.skillist.dev/api/auth/callback/google` |

Copy `apps/api/.dev.vars.example` → `apps/api/.dev.vars` and set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

**GitHub**: OAuth apps need `user:email` scope (configured). GitHub Apps need Email Addresses → Read-only.

**Google**: Set `BETTER_AUTH_URL` to your API origin to avoid `redirect_uri_mismatch`.

## Quick start

```bash
pnpm install
pnpm setup:local   # creates .env, .dev.vars, wrangler.local.jsonc

pnpm db:migrate

# Terminal 1 — API
pnpm dev:api

# Terminal 2 — Web
pnpm dev:web

# Terminal 3 — Docs (optional)
pnpm dev:docs
```

- API: http://localhost:8787
- Docs: http://localhost:4321 (user docs) · http://localhost:8787/docs (API reference)
- Web: http://localhost:5173

Neon project `lively-dew-31540211` is provisioned; migrations run against `DATABASE_URL` in `.env`. Local API dev merges `wrangler.jsonc` with gitignored `wrangler.local.jsonc` (Hyperdrive → Neon). Run `pnpm setup:local` to sync `DATABASE_URL` into the local overlay.

## Smoke tests

```bash
pnpm smoke          # API + web HTTP checks against production
pnpm test:e2e       # Playwright browser checks against skillist.dev
```

## Agent CLI

Install from npm:

```bash
npm install -g @skillist/cli
skillist search performance
skillist install skillist/web-perf-audit
```

Local development:

```bash
pnpm cli pull acme/my-skill -o ./my-skill
SKILLIST_API_KEY=sk_... pnpm cli push acme/my-skill ./my-skill
```

Set `SKILLIST_API_URL` (default `http://localhost:8787`) and `SKILLIST_API_KEY` for write operations.

### Publish to npm

```bash
# Requires NPM_TOKEN secret in GitHub, or local npm login
pnpm cli:build
pnpm publish:packages
```

Or trigger **Publish npm packages** in GitHub Actions after adding the `NPM_TOKEN` repository secret.

## Project structure

```
apps/
  api/     Cloudflare Worker (Hono API + SkillRealtimeHub DO)
  web/     React SPA (registry, editor, feedback inbox)
packages/
  auth/         Better Auth config
  cli/          Agent skill pull/push CLI
  contracts/    Shared Zod schemas
  db/           Drizzle schema + migrations
  skill-format/ agentskills.io validator
```

## Key API endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /{org}/{repo}/SKILL.md` | Hot KV read (&lt;10ms edge) on skillist.dev |
| `GET /{org}/{repo}/meta` | Discovery metadata only |
| `GET /{org}/{repo}/bundle` | Full published skill bundle |
| `GET /{org}/{repo}/scripts` | List runnable scripts |
| `POST /{org}/{repo}/run` | Hosted sandbox execution |
| `GET /v1/realtime/skills/{org}/{repo}` | WebSocket fan-out |
| `GET /v1/registry` | Public skill marketplace |
| `POST /v1/feedback/{id}/approve` | Approve + queue AI draft |

## Deploy

```bash
# Create Cloudflare resources (KV, R2, Hyperdrive, Queue)
cd apps/api
wrangler kv namespace create SKILLS_KV
wrangler r2 bucket create skillist-skills
wrangler hyperdrive create skillist-db --connection-string="$DATABASE_URL"
wrangler secret put BETTER_AUTH_SECRET

./scripts/deploy-api.sh
cd ../web && pnpm build && pnpm deploy
```

GitHub Actions (`.github/workflows/ci.yml`) runs typecheck, tests, and build on every PR; deploys API + web to Cloudflare on `main` when `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets are set.

**Provisioned resources** (General Account `2d19b3b18648f0776ff1435cba466210`):

| Resource | ID / name |
|----------|-----------|
| KV `SKILLS_KV` | `e3efe45d7f14430ab6c5868235e6755f` |
| Hyperdrive `skillist-db` | `3864600443334cd68ad86d592df9fd4a` |
| R2 bucket | `skillist-skills` |
| Queue | `skillist-ai-jobs` |

Configure `skillist.dev` and `api.skillist.dev` routes in Cloudflare dashboard. Email Sending is enabled on `skillist.dev`.

### OAuth & secrets

```bash
pnpm setup:oauth      # opens provider consoles, pushes secrets when configured
pnpm setup:secrets    # sync apps/api/.dev.vars → production Worker secrets
```

GitHub OAuth must be created manually at https://github.com/settings/applications/new (no GitHub API). Then:

```bash
GITHUB_CLIENT_ID=... GITHUB_CLIENT_SECRET=... pnpm setup:oauth
```

Google client lives in GCP project `studied-jigsaw-274214` — add Skillist redirect URIs before enabling Google sign-in.

## License

Proprietary — Skillist
