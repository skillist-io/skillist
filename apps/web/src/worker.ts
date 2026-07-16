/**
 * Apex proxy: skillist.dev/{org}/{repo}/SKILL.md|meta|bundle|scripts|run|runs
 * Cloudflare zone routes cannot put wildcards mid-path, so the web worker
 * intercepts these paths and forwards them to the API Worker via service binding.
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
    if (APEX_API_PATH.test(url.pathname) || url.pathname.startsWith("/runs/")) {
      return env.API.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
