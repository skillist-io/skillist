import { z } from "@hono/zod-openapi";

/* OpenAPI route handlers return multiple status codes */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OpenApiHandler = any;

/**
 * The API's error envelope. Every failure returns `{ error }`; 500 additionally
 * carries a `correlationId` (the CF ray) that support requests should quote —
 * see app.onError in src/index.ts.
 */
export const errorSchema = z.object({ error: z.string() });

export const internalErrorSchema = z.object({
  error: z.string(),
  // Optional on purpose: only the global app.onError handler attaches a
  // correlation id. A handler that returns an explicit 500 itself (e.g.
  // "Failed to create org") emits just `error`, so requiring this here would
  // document a field the client cannot rely on.
  correlationId: z.string().optional(),
});

function json(schema: typeof errorSchema | typeof internalErrorSchema, description: string) {
  return { description, content: { "application/json": { schema } } };
}

/**
 * Standard error responses for an operation.
 *
 * Spread into a route's `responses`. Previously no operation declared 429 —
 * despite rateLimit() wrapping all of /v1 — so clients had no documented reason
 * to back off, and 400/401/403/404 appeared only sporadically.
 *
 * Pass `isPublic: true` for unauthenticated browse/delivery routes: they cannot
 * 401/403, and declaring those would misdocument them.
 */
export function errorResponses(
  opts: {
    /** Route takes a body or non-trivial params, so validation can fail. */
    validates?: boolean;
    /** Route addresses a specific resource that may not exist. */
    notFound?: boolean;
    /** Unauthenticated route — omits 401/403. */
    isPublic?: boolean;
    /** Route enforces a uniqueness or state precondition. */
    conflict?: boolean;
  } = {},
) {
  const { validates = true, notFound = true, isPublic = false, conflict = false } = opts;

  return {
    ...(validates ? { 400: json(errorSchema, "Invalid request.") } : {}),
    ...(isPublic
      ? {}
      : {
          401: json(errorSchema, "Missing or invalid credentials."),
          403: json(errorSchema, "Authenticated, but not permitted (role or API-key scope)."),
        }),
    ...(notFound ? { 404: json(errorSchema, "Not found.") } : {}),
    ...(conflict ? { 409: json(errorSchema, "Conflicts with current state.") } : {}),
    429: json(errorSchema, "Rate limit exceeded (120 requests / 60s per IP on /v1)."),
    500: json(internalErrorSchema, "Unexpected error. Quote `correlationId` when reporting."),
  };
}
