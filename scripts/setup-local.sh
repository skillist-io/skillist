#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "$ROOT/.env" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  SECRET="$(openssl rand -base64 32)"
  sed -i.bak "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$SECRET|" "$ROOT/.env"
  rm -f "$ROOT/.env.bak"
  echo "Created .env (set OAuth credentials)"
fi

if [ ! -f "$ROOT/apps/api/.dev.vars" ]; then
  cp "$ROOT/apps/api/.dev.vars.example" "$ROOT/apps/api/.dev.vars"
  SECRET="$(grep -E '^BETTER_AUTH_SECRET=' "$ROOT/.env" | cut -d= -f2- || openssl rand -base64 32)"
  sed -i.bak "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$SECRET|" "$ROOT/apps/api/.dev.vars"
  rm -f "$ROOT/apps/api/.dev.vars.bak"
  echo "Created apps/api/.dev.vars"
fi

if [ ! -f "$ROOT/apps/api/wrangler.local.jsonc" ]; then
  cp "$ROOT/apps/api/wrangler.local.jsonc.example" "$ROOT/apps/api/wrangler.local.jsonc"
  echo "Created apps/api/wrangler.local.jsonc"
fi

echo "Local setup complete. Run: pnpm db:migrate && pnpm dev"
