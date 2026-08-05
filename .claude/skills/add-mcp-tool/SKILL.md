---
name: add-mcp-tool
description: >-
  Procedure for adding a tool to the registry MCP server (apps/api/src/mcp/).
  Use when exposing a new registry capability to agents over /mcp.
paths:
  - apps/api/src/mcp/**
argument-hint: "[tool name and what it does]"
---

# Add an MCP registry tool

Tool to add: `$ARGUMENTS`

The MCP server lives in `apps/api/src/mcp/` and is mounted at `/mcp`. Add tools in `registry-server.ts`. Delegate larger work to the `mcp-tool-dev` agent.

## Steps

1. **Define the tool** inside `buildRegistryMcpServer` in `registry-server.ts` via `server.registerTool(name, { description, inputSchema }, handler)`: a clear agent-facing `description` (agents pick tools by this) and a Zod input schema. Reuse `@skillist/contracts` schemas (e.g. `registryQuery`, `mcpServer`) rather than inventing shapes.
2. **Implement the handler** in the `registerTool` callback. Reuse the same registry read/query helpers the `/v1/registry` routes use — don't duplicate query logic. Keep results compact (agents pay for tokens). Throwing surfaces as an `isError` tool result.
3. **Register** the tool name in `REGISTRY_MCP_TOOL_NAMES` so `mcpServerInfo` / `/health` advertising reflects it.
4. **Auth**: for session-gated tools call `requireSession(name)` first (bearer tokens are verified in `handler.ts` via `createRegistryMcpAuth`). Keep gated tools registered for all callers — the tool list is `cacheScope: "public"` and must not vary by caller. The endpoint is stateless: no sessions, no KV.

## Verify

- `pnpm --filter @skillist/api exec vitest run src/mcp/registry-server.test.ts` and `transport.test.ts`; add a case for the new tool.
- `pnpm check` + `pnpm typecheck`.
- Manual: `pnpm dev:api`, then POST JSON-RPC `tools/list` (confirm it appears) and `tools/call` (confirm output) to `/mcp`.
