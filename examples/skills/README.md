# Example Agent Skills

Public demo skills for [skillist.io](https://skillist.io), compliant with [agentskills.io](https://agentskills.io/home).

| Skill | Level | Bundle contents |
|-------|-------|-----------------|
| `roll-dice` | Minimal | `SKILL.md` only |
| `web-perf-audit` | Mid | `SKILL.md`, `scripts/`, `references/` |
| `cloudflare-deploy` | Full | `SKILL.md`, `scripts/`, `references/`, `assets/`, `plugin.json` |

## Layout (agentskills.io)

```
my-skill/
├── SKILL.md          # Required: metadata + instructions
├── scripts/          # Optional: executable code
├── references/       # Optional: documentation
├── assets/           # Optional: templates, resources
└── plugin.json       # Optional: editor plugin manifest
```

## Seed to registry

```bash
# Production (Neon + R2 + KV)
pnpm install
export $(grep -E '^DATABASE_URL=' .env | xargs)
pnpm seed:registry

# Local wrangler dev
pnpm seed:registry -- --local
```

## Install via CLI

```bash
skillist search perf
skillist install skillist/web-perf-audit
skillist install skillist/cloudflare-deploy
```
