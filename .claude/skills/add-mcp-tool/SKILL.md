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

1. **Define the tool** in `registry-server.ts`: name, a clear agent-facing `description` (agents pick tools by this), and an input schema. Reuse `@skillist/contracts` schemas (e.g. `registryQuery`, `mcpServer`) rather than inventing shapes.
2. **Implement the handler** inside `handleMcpJsonRpc`. Reuse the same registry read/query helpers the `/v1/registry` routes use — don't duplicate query logic. Keep results compact (agents pay for tokens).
3. **Register** the tool in `REGISTRY_MCP_TOOLS` and make sure `mcpServerInfo` / capability advertising reflects it.
4. **Auth/session**: reads go through `createRegistryMcpAuth` (`transport.ts`); sessions are KV-backed and scoped — don't bypass or persist credentials.

## Verify

- `pnpm --filter @skillist/api exec vitest run src/mcp/registry-server.test.ts` and `transport.test.ts`; add a case for the new tool.
- `pnpm check` + `pnpm typecheck`.
- Manual: `pnpm dev:api`, then POST JSON-RPC `tools/list` (confirm it appears) and `tools/call` (confirm output) to `/mcp`.
