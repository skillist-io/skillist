# Skillist

Realtime Agent Skills management, improvement, and versioning platform for [skillist.dev](https://skillist.dev).

Built on Cloudflare Workers with Hono, Durable Objects, KV, R2, Worker AI, AI Gateway, D1, and Better Auth (passwordless). Compliant with the [agentskills.io](https://agentskills.io/home) specification.

## Stack

| Layer | Technology |
|-------|------------|
| API | Hono, zod-openapi, Scalar docs |
| Realtime | Durable Objects (WebSocket + SSE), KV hot path |
| Storage | D1 (metadata), R2 (bundles), KV (published SKILL.md) |
| Auth | Better Auth — OAuth, magic link, passkeys (no passwords) |
| AI | Worker AI + AI Gateway, Queues for async jobs |
| Front-end | Vite, TanStack Router/Query, shadcn/ui, Tailwind CSS v4 — split into `apps/web` (marketing) + `apps/console` (product) over shared `packages/ui` |

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

Configure GitHub and Google OAuth apps with the redirect URIs below. See the [GitHub OAuth app guide](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app) and [Google OAuth client guide](https://developers.google.com/identity/protocols/oauth2/web-server#creatingcred).

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
pnpm setup:local        # creates .env, .dev.vars, wrangler.local.jsonc
pnpm db:migrate         # create the local D1

# Terminal 1 — API
pnpm dev:api

# Terminal 2 — Web (public marketing site)
pnpm dev:web

# Terminal 3 — Console (authenticated product)
pnpm dev:console

# Terminal 4 — Docs (optional)
pnpm dev:docs
```

- API: http://localhost:8787
- Docs: http://localhost:4321 (user docs) · http://localhost:8787/docs (API reference)
- Web (marketing): http://localhost:5173
- Console (product): http://localhost:5174

Local dev uses a local D1 through Wrangler, so there is no database to run.

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
# Requires a local npm login
pnpm cli:build
pnpm publish:packages
```

Or trigger **Publish npm packages** in GitHub Actions. It uses npm trusted publishing, so it needs no token.

## Project structure

```
apps/
  api/      Cloudflare Worker (Hono API + SkillRealtimeHub DO)
  web/      React SPA — public marketing site (skillist.dev): landing, registry browse, public skill pages
  console/  React SPA — authenticated product (console.skillist.dev): dashboard, inventory, editor, governance, feedback
packages/
  ui/           Shared design system + UI primitives + clients, consumed as source (@skillist/ui)
  auth/         Better Auth config
  cli/          Agent skill pull/push CLI
  contracts/    Shared Zod schemas
  db/           Drizzle schema + migrations
  skill-format/ agentskills.io validator
```

Each front-end app is a Cloudflare Worker serving static assets with a **service binding** to the API worker — `src/worker.ts` proxies `/api`, `/v1`, and apex delivery paths same-origin, so there's no CORS or cross-subdomain-cookie complexity. Cross-app links use `consoleUrl()` / `webUrl()` (`@skillist/ui`), keyed off `VITE_CONSOLE_URL` / `VITE_WEB_URL`.

## Key API endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /{org}/{repo}/SKILL.md` | Hot KV read (&lt;10ms edge) on skillist.dev |
| `GET /{org}/{repo}/meta` | Discovery metadata only |
| `GET /{org}/{repo}/bundle` | Full published skill bundle |
| `GET /{org}/{repo}/scripts` | List runnable scripts |
| `POST /{org}/{repo}/run` | Hosted sandbox execution |
| `GET /v1/realtime/skills/{org}/{repo}` | WebSocket fan-out |
| `GET /v1/registry` | Public registry browse API |
| `POST /v1/feedback/{id}/approve` | Approve + queue AI draft |

## Deploy

```bash
# Create Cloudflare resources (KV, R2, D1, Queue)
cd apps/api
wrangler kv namespace create SKILLS_KV
wrangler r2 bucket create skillist-skills
wrangler d1 create skillist --location enam
wrangler secret put BETTER_AUTH_SECRET

./scripts/deploy-api.sh
cd ../web && pnpm build && pnpm deploy         # marketing → skillist.dev
cd ../console && pnpm build && pnpm deploy     # product → console.skillist.dev
```

GitHub Actions (`.github/workflows/ci.yml`) runs typecheck, tests, and build on every PR; deploys API + web + console + docs to Cloudflare on `main` when `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets are set.

**Required repository secrets** (repository-level — organization secrets do not resolve in this workflow):

| Secret | Used by | Purpose |
|--------|---------|---------|
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | all deploy jobs | Cloudflare deploys |
| `SKILLIST_E2E_API_KEY` | `smoke` | authenticated post-deploy checks; missing → those tests skip silently |

**Provisioned resources** (General Account `2d19b3b18648f0776ff1435cba466210`):

| Resource | ID / name |
|----------|-----------|
| KV `SKILLS_KV` | `e3efe45d7f14430ab6c5868235e6755f` |
| D1 `skillist` | `9b901aed-8945-4574-ae3c-65c9430d05c2` |
| R2 bucket | `skillist-skills` |
| Queue | `skillist-ai-jobs` |

Configure `skillist.dev` (marketing web), `console.skillist.dev` (product console), and `api.skillist.dev` routes in Cloudflare dashboard; both front-end workers hold a service binding to the API worker. Email Sending is enabled on `skillist.dev`.

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

Proprietary — see [LICENSE](LICENSE).

Two packages are published to npm under **MIT** and carry their own LICENSE
files, because they are client-side tools meant to be read and forked:
[`@skillist/cli`](packages/cli) and
[`@skillist/skill-format`](packages/skill-format).
