---
name: add-api-route
description: >-
  Step-by-step procedure for adding an endpoint to the apps/api Cloudflare
  Worker. Use when adding a /v1 OpenAPI route or an apex /{org}/{repo}/... route,
  so it lands in /openapi.json + /docs, is authed correctly, and doesn't break
  the apex auth regex.
paths:
  - apps/api/src/routes/**
  - apps/api/src/index.ts
argument-hint: "[resource or endpoint description]"
---

# Add an API route

Target: `$ARGUMENTS`

Follow this procedure (canonical example to copy: `apps/api/src/routes/skills.ts`).

## 1. Decide the surface

- **Versioned API** → `/v1/...`. Already wrapped with `rateLimit()` + `authMiddleware`. This is the default.
- **Apex delivery** (`/{org}/{repo}/SKILL.md|meta|bundle`) → public read; pattern in `apps/api/src/routes/delivery.ts`.
- **Apex execution** (`/{org}/{repo}/scripts|run|runs`) → authed via the inline path-regex in `index.ts`.

## 2. Schemas first

Reuse Zod schemas from `@skillist/contracts`. Add inline `z` objects only for params not already defined there.

## 3. Define the route with `createRoute`

```ts
type AppEnv = { Bindings: Env; Variables: { auth: AuthContext; db: WorkerDb } };
export const fooRoutes = new OpenAPIHono<AppEnv>();

const listFoo = createRoute({
  method: "get",
  path: "/orgs/{orgId}/foo",
  tags: ["Foo"],
  request: { params: z.object({ orgId: z.string() }) },
  responses: { 200: { content: { "application/json": { schema: FooList } }, description: "OK" } },
});

fooRoutes.openapi(listFoo, async (c) => {
  const { orgId } = c.req.valid("param");
  await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer");
  // ...use c.var.db / c.env...
  return c.json(result, 200);
});
```

## 4. Register it

Add the router to the `v1.route("/", ...)` block in `apps/api/src/index.ts`.

## 5. ⚠️ Apex-route auth regex

If you added/renamed an apex `/{org}/{repo}/...` path, update the auth path-regex in **both**:
- `apps/api/src/index.ts` (`/^\/[^/]+\/[^/]+\/(scripts|run|runs)(\/|$)/`)
- `apps/web/vite.config.ts` (dev proxy mirror)

Missing either breaks auth or local dev.

## 6. Verify

- Add/extend a colocated `*.test.ts` (runs under `@cloudflare/vitest-pool-workers`).
- `pnpm --filter @skillist/api exec vitest run <path>` → `pnpm check` → `pnpm typecheck`.
- Confirm the route shows in `/openapi.json` (visit `/docs` via `pnpm dev:api`).
