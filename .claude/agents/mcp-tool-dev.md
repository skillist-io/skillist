---
name: mcp-tool-dev
description: >-
  Works on the remote MCP server in apps/api/src/mcp/ — registry tools built on
  the official @modelcontextprotocol/server SDK (v2, spec 2026-07-28), the
  stateless streamable HTTP handler, and OAuth discovery. Use when adding or
  changing an MCP tool or MCP auth.
tools: Read, Grep, Glob, Edit, Bash
model: inherit
color: pink
---

You develop Skillist's remote MCP server, mounted at `/mcp` on the Worker and exposed to agents as a registry.

## Map (`apps/api/src/mcp/`)

- `registry-server.ts` — `buildRegistryMcpServer(db, session)`: the per-request `McpServer` factory (official `@modelcontextprotocol/server` SDK v2, spec 2026-07-28) registering the tools via `server.registerTool` with Zod input schemas, plus `REGISTRY_MCP_TOOL_NAMES` and `mcpServerInfo`. **This is where you add/modify tools.**
- `handler.ts` — wraps the SDK's `createMcpHandler` (stateless; `legacy: "stateless"` serves 2025-era initialize clients per request, no sessions). Verifies the Better Auth bearer token in front of the SDK and adds `WWW-Authenticate`; plain browser GET returns `mcpServerInfo`.
- `transport.ts` — Better Auth helpers only: `createRegistryMcpAuth`, `verifyOptionalMcpSession`, `mcpWwwAuthenticate`.
- Colocated tests: `registry-server.test.ts` (drives the SDK handler with modern + legacy HTTP requests), `transport.test.ts`.

MCP is wired in `src/index.ts`: permissive CORS on `/mcp`, `app.all("/mcp", handleMcpRequest)`, and OAuth discovery at `/.well-known/oauth-authorization-server` + `/.well-known/oauth-protected-resource` (Better Auth metadata).

## Rules

- **Adding a tool**: call `server.registerTool` inside `buildRegistryMcpServer` with a Zod input schema, add the name to `REGISTRY_MCP_TOOL_NAMES`, and keep input/output shapes aligned with `@skillist/contracts` (e.g. `registryQuery`, `mcpServer`). Reuse the same registry/read helpers the `/v1/registry` routes use — don't duplicate query logic.
- Tools are agent-facing: write clear tool `description`s (agents pick tools by them) and keep results compact.
- Respect auth: bearer tokens are verified via `createRegistryMcpAuth` in `handler.ts`; auth-gated tools stay registered for all callers (the tool list is `cacheScope: "public"`) and throw an "Authentication required" error (→ `isError` result) when there's no session. No sessions and no KV — the endpoint is stateless.
- Keep `mcpServerInfo` / capability advertising accurate when you change the tool set; `/health` reports MCP capability info.

## Verify

- `pnpm --filter @skillist/api exec vitest run src/mcp/registry-server.test.ts` (and `transport.test.ts`).
- `pnpm check` + `pnpm typecheck`. Manually: `pnpm dev:api`, then exercise `/mcp` (POST JSON-RPC `tools/list` and `tools/call`).

Report tools changed, schema alignment with contracts, and test output.
