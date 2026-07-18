---
name: deploy
description: >-
  How Skillist deploys (CI-driven on main) and the guardrails for any manual
  Cloudflare deploy. Use when asked about deploying, releasing, wrangler deploy,
  or publishing the npm packages.
---

# Deploy & release

**Default: you do not deploy manually.** CI owns it.

## Normal path (automatic)

`.github/workflows/ci.yml` runs on push to `main`: `check → typecheck → test → playwright → build`, and only if all pass, deploys:

- **api** → `wrangler deploy --config apps/api/wrangler.production.jsonc`
- **web** → built with `VITE_API_URL=https://api.skillist.dev`, then deployed
- **docs** → `wrangler deploy`

Then a **smoke** job runs `pnpm smoke` against production. So: land it on `main` via a merged PR and let CI deploy. Don't run production `wrangler deploy` by hand unless explicitly asked to hotfix.

## Manual deploy (only if explicitly requested)

- Requires Cloudflare credentials/secrets already configured. Use the **production** config: `apps/api/wrangler.production.jsonc` (custom domains, real resource IDs, larger containers). Never deploy the base `wrangler.jsonc` (that's local-dev bindings) to production.
- Worker secrets are managed separately: `pnpm setup:secrets`. Never inline secrets into `vars`.

## npm packages (`@skillist/skill-format`, `@skillist/cli`)

Published via the **manual** `workflow_dispatch` workflow `.github/workflows/publish-packages.yml` (builds skill-format then cli, skips versions already published, uses `NPM_TOKEN`). Locally: `pnpm publish:packages`. Bump the package `version` first; the workflow no-ops if the version already exists.

## Before any deploy

Run `/preflight` (or `pnpm check && pnpm typecheck && pnpm test`). Deploys should only follow green gates.
