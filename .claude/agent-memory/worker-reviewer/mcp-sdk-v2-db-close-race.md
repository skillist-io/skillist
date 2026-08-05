---
name: mcp-sdk-v2-db-close-race
description: apps/api/src/mcp/handler.ts closes the per-request db in `finally` right after `await handler.fetch()`, but @modelcontextprotocol/server v2's legacy (pre-2026-07-28) leg resolves fetch() before tool DB queries finish — empirically confirmed race, not yet fixed as of 2026-08-04.
metadata:
  type: project
---

`apps/api/src/mcp/handler.ts` migrated from a hand-rolled JSON-RPC MCP implementation to `@modelcontextprotocol/server` v2 (stateless streamable HTTP, spec 2026-07-28). The new handler does:

```ts
const db = createWorkerDb(c.env);
try {
  const handler = createMcpHandler(() => buildRegistryMcpServer(db, mcpSession), { responseMode: "json" });
  const response = await handler.fetch(c.req.raw);
  ...
  return new Response(response.body, ...);
} finally {
  closeWorkerDb(db, safeExecutionCtx(c));
}
```

I instrumented a throwaway vitest file (built, ran, deleted — not committed) calling `handler.fetch()` for a `tools/call` request against a mock db whose query resolves after a 20ms delay. Result: `await handler.fetch()` resolved **before** the mocked db query's promise settled — i.e. the SDK's legacy/non-2026-07-28-header leg returns a `Response` whose body (and the tool handler's in-flight DB work) is still being produced asynchronously after `fetch()`'s await resolves. `responseMode: "json"` only pins the *modern* leg (confirmed by the project's own `registry-server.test.ts` legacy-initialize test, which still gets an SSE-formatted body back).

Consequence: `closeWorkerDb` (which calls postgres.js `client.end({ timeout: 5 })`, refusing new queries immediately) can fire while a tool's DB query is mid-flight or before a later query in a multi-step tool handler (`toolAddSkillToProject` does 4-5 sequential round trips) has even been issued. The pre-migration hand-rolled handler always fully `await`ed JSON-RPC processing (including all DB work) before constructing any response bytes, so this race did not exist before the SDK swap — it's a regression specific to adopting the SDK's transport.

**Why:** Legacy MCP clients (2025-06-18/2025-03-26/2024-11-05, still explicitly supported via `legacy: "stateless"` per `registry-server.ts`) are a real, reachable production path, not just a theoretical edge case — every registered tool touches the db.

**How to apply:** When reviewing `apps/api/src/mcp/handler.ts` again, check whether this has been fixed (e.g. tee the response body and only close `db` after the tee'd branch fully drains/cancels, or drop legacy protocol support entirely). Also see [[workers-review-verify-dont-assume-async-timing]] for the general technique used to find this.
