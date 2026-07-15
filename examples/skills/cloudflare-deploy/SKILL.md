---
name: cloudflare-deploy
description: Deploy and validate Cloudflare Workers projects with wrangler — bindings checklist, preflight scripts, reference docs, and starter templates. Full agentskills.io bundle with scripts, references, assets, and plugin manifest.
license: MIT
compatibility: Cursor, Claude Code, Codex, VS Code Copilot — requires wrangler 4.x and a Cloudflare account
metadata:
  author: skillist
  category: infrastructure
  level: full
allowed-tools: Bash, Read, Write, Grep
---

# Cloudflare Workers Deploy

End-to-end workflow for shipping a Worker safely: validate config, check bindings, dry-run deploy, and post-deploy smoke test.

## When to activate

- User wants to deploy a Worker, Pages Function, or full-stack app on Cloudflare
- Reviewing `wrangler.jsonc` / `wrangler.toml` before production
- Setting up KV, R2, D1, Hyperdrive, Queues, or Durable Objects bindings
- CI/CD pipeline needs a repeatable deploy checklist

## Workflow

1. **Discover** — Identify project root, wrangler config, and entry `main` file.
2. **Preflight** — Run `scripts/preflight.sh` to verify wrangler CLI and required env vars.
3. **Validate** — Run `scripts/validate-config.sh` against the config file.
4. **Bindings review** — Compare config against `references/bindings-checklist.md`.
5. **Template** — If starting fresh, copy `assets/wrangler.template.jsonc` and adapt.
6. **Dry run** — `wrangler deploy --dry-run` before real deploy.
7. **Deploy** — `wrangler deploy` with production config when user confirms.
8. **Smoke test** — Hit `/health` or documented endpoint; log status and latency.

## Progressive disclosure

| Stage | Load |
|-------|------|
| Discovery | This file metadata only |
| Activation | Full SKILL.md |
| Execution | scripts + references as needed |

## Output template

```markdown
## Deploy report — {worker-name}

- Config: {path}
- Bindings: KV ✓ R2 ✓ Hyperdrive ✓
- Dry-run: passed
- Deploy URL: https://…
- Smoke test: 200 OK ({ms}ms)
```

## Safety rules

- Never print or commit API tokens, `BETTER_AUTH_SECRET`, or database URLs.
- Confirm target environment (preview vs production) before deploy.
- Use `--dry-run` first unless user explicitly skips.
- Do not deploy from unreviewed diffs when `validate-config.sh` fails.

## Bundled resources

- `scripts/preflight.sh` — CLI and auth checks
- `scripts/validate-config.sh` — JSONC/TOML sanity checks
- `references/bindings-checklist.md` — binding types and gotchas
- `references/deploy-runbook.md` — step-by-step runbook
- `assets/wrangler.template.jsonc` — starter config
- `plugin.json` — Cursor/plugin manifest for bundled context
