---
name: registry-mcp
description: Discover and install agent skills via the Skillist registry MCP server — search, facets, install commands, and skill metadata without leaving your agent.
license: MIT
metadata:
  author: skillist
  category: utilities
  tags: mcp, registry, discovery, agents
  level: mid
---

# Registry MCP

Use this skill when the user wants to search, browse, or install skills from the Skillist public registry using MCP tools.

## When to activate

- User asks to find or install an agent skill from skillist.dev
- User wants registry search by category, tag, or agent (Cursor, Claude, VS Code)
- User needs install commands or skill metadata before pulling a bundle

## MCP server

Connect your agent to the Skillist registry MCP endpoint:

```
https://api.skillist.dev/mcp
```

### Cursor configuration

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "skillist-registry": {
      "url": "https://api.skillist.dev/mcp"
    }
  }
}
```

OAuth-capable MCP clients (e.g. Cursor) discover authorization via
`/.well-known/oauth-protected-resource` and sign in at `https://skillist.dev/login`.
Full setup guide: [docs.skillist.dev/mcp/connect](https://docs.skillist.dev/mcp/connect/).
Registry read tools work without a token; authenticated sessions are available for
future user-specific tools.

## Available tools

| Tool | Purpose |
|------|---------|
| `registry_search` | Search skills by query, category, tag, agent, sort |
| `registry_get_skill` | Full metadata for `org/repo` including eval uplift |
| `registry_facets` | List categories, tags, and compatible agents |
| `registry_install_help` | CLI install commands and SKILL.md URL |

## Procedure

1. Call `registry_facets` when the user needs browse filters.
2. Call `registry_search` with `query`, `category`, `tag`, or `agent` as needed.
3. For a specific skill, call `registry_get_skill` with `org` and `repo`.
4. Call `registry_install_help` to return `npm install -g @skillist/cli` and `skillist install org/repo`.
5. Prefer skills with higher eval uplift and quality scores when multiple matches exist.

## Output format

```
Found 3 skills:
- skillist/web-perf-audit (Q95, uplift +21) — hosted sandbox performance audits
  Install: skillist install skillist/web-perf-audit
  Page: https://skillist.dev/skillist/web-perf-audit
```

## Constraints

- Registry MCP is read-only — publish and run require the Skillist CLI with an API key.
- Always include the install command when recommending a skill.
- Skill pages and SKILL.md live at `https://skillist.dev/{org}/{repo}` and `https://skillist.dev/{org}/{repo}/SKILL.md`.
