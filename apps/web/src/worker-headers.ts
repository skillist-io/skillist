/**
 * Response-header helpers for the SPA Worker.
 *
 * Split out of `worker.ts` because that file is excluded from this app's
 * tsconfig (it is Workers code, not React code, and uses runtime globals like
 * HTMLRewriter). These two functions touch nothing but `Response`/`Headers`,
 * so they live here where they can be type-checked and unit-tested.
 */

/**
 * Response headers this SPA worker adds to everything it serves itself (the API
 * proxy branch is skipped — the API worker sets its own via `secureHeaders()`).
 *
 * Deliberately scoped to directives that harden without risking breakage: no
 * `default-src`/`script-src`, because the app loads Google Tag Manager and an
 * inline theme-bootstrap script, and a wrong value there breaks the page with no
 * way to verify here. `object-src`/`base-uri`/`frame-ancestors`/`form-action`
 * add real defense (plugin injection, base-tag hijack, clickjacking, form
 * exfiltration) as a second layer behind the SEO-injection escaping — none of
 * which touch script/style/analytics loading. A strict script-src (hashing the
 * theme script + a GTM nonce) is a follow-up that needs a build+smoke check.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

/**
 * Copy a response and fill in any security header it is missing (source headers
 * may be immutable).
 *
 * Fills in rather than overwrites: asset responses already carry the stricter
 * set from `public/_headers`, including a real `default-src`/`script-src` CSP.
 * Overwriting meant the four-directive fallback above replaced that policy on
 * every HTML and asset response — the strict CSP was written, deployed, and
 * never actually served. Worker-rendered responses (robots/sitemap/llms.txt)
 * get no `_headers` treatment, so the fallback still matters for them.
 */
export function withSecurityHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/**
 * The SPA shell must never be cached hard — it is what every route is served
 * from, and the Worker injects per-route metadata into it.
 *
 * This lives in the Worker rather than in `_headers` because `_headers` applies
 * every matching rule and concatenates the values, so a `Cache-Control` on `/*`
 * also landed on `/assets/*` and its `no-cache` beat the immutable directive
 * there — revalidating every hashed chunk on every load. The Worker sees every
 * HTML path (see run_worker_first), so it is the one place that can tell the
 * shell from a hashed asset.
 */
export function withShellCacheControl(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-cache");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
