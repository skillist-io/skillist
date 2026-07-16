/**
 * Proxies API traffic to the API Worker via service binding:
 * - /v1/*, /api/* (same-origin SPA fetches)
 * - /{org}/{repo}/SKILL.md|meta|bundle|scripts|run|runs (apex delivery;
 *   zone routes cannot use mid-path wildcards)
 * - /runs/*
 */
const APEX_API_PATH =
  /^\/[^/]+\/[^/]+\/(SKILL\.md|meta|bundle|scripts|run|runs)(\/.*)?$/;

type ServiceFetcher = {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

export interface Env {
  ASSETS: ServiceFetcher;
  API: ServiceFetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Same-origin API proxy so the SPA can use relative /v1 and /api URLs.
    // Apex delivery paths cannot be zone-routed (no mid-path wildcards).
    if (
      url.pathname.startsWith("/v1/") ||
      url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/runs/") ||
      APEX_API_PATH.test(url.pathname)
    ) {
      return env.API.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
