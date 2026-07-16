# skillist

CLI for the [Skillist](https://skillist.dev) Agent Skills platform — search, install, publish, and run skills from the public registry.

## Install

```bash
npm install -g @skillist/cli
```

## Quick start

```bash
# Search the public registry
skillist search performance

# Install a skill into your project
skillist install skillist/web-perf-audit

# Run a hosted script (public skills)
skillist run skillist/web-perf-audit --script scripts/collect-metrics.sh --url https://example.com

# Publish from a local bundle (requires API key)
export SKILLIST_API_KEY=sk_...
skillist publish my-org/my-skill ./skills/my-skill
```

## Environment

| Variable | Description |
|----------|-------------|
| `SKILLIST_API_URL` | API base URL (default: `https://api.skillist.dev`) |
| `SKILLIST_API_KEY` | Bearer token (`sk_...`) for push, publish, and private runs |

## Commands

- `skillist search [query]` — search registry with filters
- `skillist install <org>/<skill>` — download and record in `.skillist.lock`
- `skillist pull <org>/<skill>` — download without lockfile
- `skillist push <org>/<skill> <dir>` — upload draft version
- `skillist publish <org>/<skill> <dir>` — push and publish
- `skillist run <org>/<skill> --script <path> [--url <url>] [--stream]` — hosted execution
- `skillist eval <org>/<skill> [--wait]` — queue skill eval on latest draft
- `skillist rollback <org>/<skill> <semver>` — roll back to a previous published version
- `skillist update [org/skill]` — refresh installed skills
- `skillist list` — show lockfile entries
