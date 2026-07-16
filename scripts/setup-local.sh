#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NEON_URL="${DATABASE_URL:-}"

if [ -z "$NEON_URL" ] && [ -f "$ROOT/.env" ]; then
  NEON_URL="$(grep -E '^DATABASE_URL=' "$ROOT/.env" | cut -d= -f2- || true)"
fi

if [ ! -f "$ROOT/.env" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  SECRET="$(openssl rand -base64 32)"
  if [ -n "$NEON_URL" ]; then
    sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=$NEON_URL|" "$ROOT/.env"
    rm -f "$ROOT/.env.bak"
  fi
  sed -i.bak "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$SECRET|" "$ROOT/.env"
  rm -f "$ROOT/.env.bak"
  echo "Created .env (set DATABASE_URL and OAuth credentials)"
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

if [ -n "$NEON_URL" ]; then
  python3 -c "
import json, sys
path = sys.argv[1]
url = sys.argv[2]
with open(path) as f:
    cfg = json.load(f)
cfg['main'] = 'src/index.ts'
cfg['compatibility_date'] = '2025-01-15'
cfg['compatibility_flags'] = ['nodejs_compat']
cfg['hyperdrive'][0]['localConnectionString'] = url
with open(path, 'w') as f:
    json.dump(cfg, f, indent=2)
    f.write('\n')
" "$ROOT/apps/api/wrangler.local.jsonc" "$NEON_URL"
  echo "Synced Hyperdrive local connection from DATABASE_URL"
fi

echo "Local setup complete. Run: pnpm db:migrate && pnpm dev"
