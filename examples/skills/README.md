# Example Agent Skills

Public demo skills for [skillist.dev](https://skillist.dev), compliant with [agentskills.io](https://agentskills.io/home).

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
# Production (D1 + R2 + KV). Needs wrangler login or CLOUDFLARE_API_TOKEN.
pnpm install
pnpm seed:registry

# Local wrangler dev
pnpm seed:registry --local
```

## Install via CLI

```bash
skillist search perf
skillist install skillist/web-perf-audit
skillist install skillist/cloudflare-deploy
```
