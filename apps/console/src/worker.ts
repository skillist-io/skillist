/**
 * Proxies API traffic to the API Worker via service binding:
 * - /v1/*, /api/* (same-origin SPA fetches)
 * - /agents/* (Skillist Agent WebSocket + get-messages; service bindings
 *   forward the Upgrade so the socket rides same-origin with the session cookie)
 * - /{org}/{repo}/SKILL.md|meta|bundle|scripts|run|runs (apex delivery;
 *   zone routes cannot use mid-path wildcards)
 * - /runs/*
 */
const APEX_API_PATH = /^\/[^/]+\/[^/]+\/(SKILL\.md|meta|bundle|scripts|run|runs)(\/.*)?$/;

type ServiceFetcher = {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

export interface Env {
  ASSETS: ServiceFetcher;
  API: ServiceFetcher;
}

/**
 * Security headers for the console's own asset responses (the API proxy branch
 * is skipped — the API worker sets its own via `secureHeaders()`). Scoped to
 * directives that harden without breaking script/style loading: no
 * `default-src`/`script-src`, because the shell has an inline theme-bootstrap
 * script whose hash can't be verified without a build. `frame-ancestors 'none'`
 * (clickjacking on an authenticated surface), `object-src`, `base-uri`, and
 * `form-action` are all safe here. A strict script-src is a follow-up.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

function withSecurityHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Same-origin API proxy so the SPA can use relative /v1 and /api URLs.
    // Apex delivery paths cannot be zone-routed (no mid-path wildcards). The API
    // worker sets its own security headers, so this branch returns untouched.
    if (
      url.pathname.startsWith("/v1/") ||
      url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/agents/") ||
      url.pathname.startsWith("/runs/") ||
      APEX_API_PATH.test(url.pathname)
    ) {
      return env.API.fetch(request);
    }
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
};
