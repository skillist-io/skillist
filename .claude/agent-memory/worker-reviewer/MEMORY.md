# Memory index

- [MCP SDK v2 db-close race](mcp-sdk-v2-db-close-race.md) — apps/api/src/mcp/handler.ts `finally { closeWorkerDb }` races the legacy MCP leg's in-flight tool db queries; empirically confirmed, unfixed as of 2026-08-04
- [Verify, don't assume, async SDK timing](workers-review-verify-dont-assume-async-timing.md) — write a throwaway instrumented vitest test to check if a wrapped SDK's fetch() resolves before/after its internal async work finishes, before trusting code comments
