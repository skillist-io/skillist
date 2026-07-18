---
description: Secret and local-config files — never read into context, edit, or commit.
paths:
  - "**/.dev.vars"
  - "**/.env"
  - "**/wrangler.local.jsonc"
---

# Secrets & local config

Skillist's enterprise-ready bar requires strict data hygiene: no persisted credentials, per-user cache scoping.

- **Never commit** `**/.dev.vars`, `.env` / `.env.*` (except `.example` / `.env.production`), `wrangler.local.jsonc`, or `tests/e2e/.auth/`. They are gitignored for a reason.
- To change local secrets, edit the committed template (`apps/api/.dev.vars.example`, `.env.example`, `wrangler.local.jsonc.example`) or regenerate via `pnpm setup:local`. Push production secrets with `pnpm setup:secrets` — never inline them into `vars` or code.
- The Worker reaches Neon Postgres **only through the `HYPERDRIVE` binding**. A raw connection string in Worker code or wrangler config is an anti-pattern.
- Don't echo secret values into logs, tests, or chat. A `PreToolUse` hook blocks writes to these files as a backstop.
