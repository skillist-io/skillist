# skillist

CLI for the [Skillist](https://skillist.io) Agent Skills platform — search, install, publish, review, inventory, and run skills from the public registry.

## Install

```bash
npm install -g @skillist/cli
```

## Quick start

```bash
# Search the public registry
skillist search performance

# Install a skill into your project (org install policy applies when SKILLIST_API_KEY is set)
skillist install skillist/web-perf-audit

# Deliver the pinned set to every agent harness in the project
skillist sync
skillist sync --check   # CI gate: exits 1 if a harness directory has drifted

# CI quality + security gate
skillist review ./skills/my-skill --threshold 80 --fail-on high --json

# Run a hosted script (public skills)
skillist run skillist/web-perf-audit --script scripts/collect-metrics.sh --url https://example.com

# Publish from a local bundle (requires API key)
export SKILLIST_API_KEY=sk_...
skillist publish my-org/my-skill ./skills/my-skill
```

Public skill pages and delivery live at GitHub-style URLs:

```
https://skillist.io/{org}/{repo}
https://skillist.io/{org}/{repo}/SKILL.md
```

## Environment

| Variable | Description |
|----------|-------------|
| `SKILLIST_API_URL` | API base URL (default: `https://api.skillist.io`) |
| `SKILLIST_DELIVERY_URL` | Public delivery URL (default: `https://skillist.io`) |
| `SKILLIST_API_KEY` | Bearer token (`sk_...`) for push, publish, and private runs |

## Commands

- `skillist search [query]` — search registry with filters
- `skillist install <org>/<repo>[@version]` — download, verify the published sha256, and record in `.skillist.lock`
- `skillist pull <org>/<repo>[@version]` — download without lockfile
- `skillist push <org>/<repo> <dir>` — upload draft version
- `skillist publish <org>/<repo> <dir>` — push and publish
- `skillist run <org>/<repo> --script <path> [--url <url>] [--stream]` — hosted execution
- `skillist eval <org>/<repo> [--wait]` — queue skill eval on latest draft
- `skillist rollback <org>/<repo> <semver>` — roll back to a previous published version
- `skillist update [org/repo]` — refresh installed skills
- `skillist sync` — materialize the lockfile into every detected agent harness directory
  (`.claude/skills`, `.cursor/skills`, `.agents/skills`, `.gemini/skills`, `.codex/skills`,
  `.vscode/skills`) — `[--check]` to plan only and exit 1 on drift, `[--prune]`, `[--force]`,
  `[--target <dir>]`, `[--scope project|user]`, `[--link copy|symlink]`, `[--enforce-required]`
- `skillist list` — show lockfile entries
- `skillist review <dir> [--threshold N] [--fail-on sev] [--json]` — quality + security CI gate
- `skillist required-skills check [--org <slug>]` — verify lockfile against org required skills
- `skillist inventory scan [--org <slug>]` — BFS-discover local agent skills and POST scan
- `skillist inventory import --github-org <org>` — scan GitHub org via `gh` and POST inventory
- `skillist inventory list [--org <slug>]` — list org inventory from the API
- `skillist mcp proxy <org>/<name>` — stdio proxy to an org MCP gateway server
