---
name: workers-review-verify-dont-assume-async-timing
description: When a Workers handler wraps a third-party SDK's .fetch()/handler and closes scoped resources (db, ctx) in a finally right after awaiting it, don't trust code comments about buffering/streaming behavior — write a throwaway instrumented vitest test to empirically confirm whether the resource is still in use when the await resolves.
metadata:
  type: feedback
---

Rule: for `apps/api` code review, when a request handler does `const x = await thirdPartySdk.fetch(req); ... finally { closeScopedResource(x) }`, and the SDK can return a streaming `Response.body` for some code paths (SSE, legacy protocol fallback, etc.), don't take inline comments about "this only affects the legacy leg" or "our tools never stream" at face value — the comment author may be right about intent but wrong about the SDK's actual internal scheduling.

**Why:** Found in [[mcp-sdk-v2-db-close-race]] — the code comments in `apps/api/src/mcp/handler.ts`/`registry-server.ts` were directionally correct (responseMode:"json" does pin the modern leg) but didn't establish whether the *legacy* leg's async work finishes before or after `fetch()` resolves. Writing a small instrumented test (mock db call that logs an event before/after a delayed resolve, compared against events logged around the `await handler.fetch()` call) gave a definitive answer in about 5 minutes, versus guessing from `node_modules` types — which in this sandbox are frequently permission-denied to read directly (`dist/*.d.mts` files under `node_modules` are blocked even though `README.md`/`package.json` at the package root are readable).

**How to apply:** Build the throwaway test inside the actual package (`apps/api/src/mcp/_diag.*.test.ts` or similar), run it with `pnpm --filter @skillist/api exec vitest run <path> --reporter=verbose --silent=false` to see `console.log` event-order output, then delete it with `rm -f` before finishing (plain `rm` may be aliased to `rm -i` and silently no-op on "yes/no" prompts in this environment — verify with `ls`/`git status` after deleting scratch files created inside the repo, don't assume the delete succeeded).
