import {
  llmsTxt,
  type RegistryEntry,
  robotsTxt,
  type SkillMeta,
  siteJsonLd,
  sitemapXml,
  skillHeadTags,
  skillJsonLd,
  skillNoscriptBody,
} from "./seo";

/**
 * Proxies API traffic to the API Worker via service binding:
 * - /v1/*, /api/* (same-origin SPA fetches)
 * - /{org}/{repo}/SKILL.md|meta|bundle|scripts|run|runs (apex delivery;
 *   zone routes cannot use mid-path wildcards)
 * - /runs/*
 *
 * It also renders the SEO surfaces that a client-rendered SPA cannot: per-route
 * head tags + JSON-LD on skill pages, real 404 status codes, and the
 * robots/sitemap/llms.txt text endpoints.
 */
const APEX_API_PATH = /^\/[^/]+\/[^/]+\/(SKILL\.md|meta|bundle|scripts|run|runs)(\/.*)?$/;

/**
 * A public skill page: exactly two path segments. Three-segment apex delivery
 * paths are matched by APEX_API_PATH above and proxied before this is reached.
 * `@`-pinned specifiers are excluded — those are delivery URLs, not pages.
 */
const SKILL_PAGE_PATH = /^\/([^/@]+)\/([^/@]+)\/?$/;

/** Single-segment app routes that must not be mistaken for an org. */
const RESERVED_SEGMENTS = new Set(["registry", "api", "v1", "runs", "assets"]);

type ServiceFetcher = {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

export interface Env {
  ASSETS: ServiceFetcher;
  API: ServiceFetcher;
}

const TEXT_HEADERS = {
  "content-type": "text/plain; charset=utf-8",
  // Cheap to regenerate and changes as the registry changes.
  "cache-control": "public, max-age=300, stale-while-revalidate=3600",
};

function wantsHtml(request: Request): boolean {
  return request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");
}

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
const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

/** Copy a response and layer on the security headers (source headers may be immutable). */
function withSecurityHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** Fetches the SPA shell from the assets binding. */
async function shell(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  url.pathname = "/index.html";
  return env.ASSETS.fetch(new Request(url.toString(), { method: "GET" }));
}

/**
 * Pulls the public registry for the sitemap / llms.txt.
 *
 * Bounded deliberately: these endpoints must not become an unbounded scan of the
 * registry as it grows. If the cap is ever hit the output silently truncates, so
 * revisit with a paginated sitemap index rather than raising it indefinitely.
 */
async function fetchRegistry(env: Env): Promise<RegistryEntry[]> {
  const res = await env.API.fetch("https://api.internal/v1/registry?limit=1000");
  if (!res.ok) return [];
  const body = (await res.json()) as { items?: RegistryEntry[] } | RegistryEntry[];
  return Array.isArray(body) ? body : (body.items ?? []);
}

async function fetchSkillMeta(env: Env, org: string, repo: string): Promise<SkillMeta | null> {
  // The meta endpoint is public and fails closed on non-public visibility, so a
  // private skill returns 404 here and we render a real 404 page.
  const res = await env.API.fetch(
    `https://api.internal/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/meta`,
  );
  if (!res.ok) return null;
  return (await res.json()) as SkillMeta;
}

/**
 * Injects per-skill head tags, JSON-LD, and a crawler-visible body into the SPA
 * shell. Uses HTMLRewriter so the shell stays the single source of truth for
 * scripts/styles — no duplicated HTML template to drift.
 */
function injectSkillPage(shellRes: Response, meta: SkillMeta): Response {
  return new HTMLRewriter()
    .on("title", {
      element(el) {
        el.remove();
      },
    })
    .on('meta[name="description"]', {
      element(el) {
        el.remove();
      },
    })
    .on('meta[property^="og:"], meta[name^="twitter:"]', {
      element(el) {
        el.remove();
      },
    })
    .on("head", {
      element(el) {
        el.append(`\n    ${skillHeadTags(meta)}\n    ${skillJsonLd(meta)}\n  `, { html: true });
      },
    })
    .on("#root", {
      element(el) {
        // Replaced by React on hydration; present only for non-JS crawlers.
        el.setInnerContent(skillNoscriptBody(meta), { html: true });
      },
    })
    .transform(shellRes);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    // Same-origin API proxy so the SPA can use relative /v1 and /api URLs.
    // Apex delivery paths cannot be zone-routed (no mid-path wildcards). The API
    // worker sets its own security headers, so this branch returns untouched.
    if (
      pathname.startsWith("/v1/") ||
      pathname.startsWith("/api/") ||
      pathname.startsWith("/runs/") ||
      APEX_API_PATH.test(pathname)
    ) {
      return env.API.fetch(request);
    }

    // Everything below is served by this worker (SEO text, injected skill
    // pages, the SPA shell/assets) — all get the security headers.
    return withSecurityHeaders(await serve(request, env, url));
  },
};

async function serve(request: Request, env: Env, url: URL): Promise<Response> {
  const { pathname } = url;

  if (pathname === "/robots.txt") {
    return new Response(robotsTxt(), { headers: TEXT_HEADERS });
  }

  if (pathname === "/sitemap.xml") {
    const entries = await fetchRegistry(env);
    return new Response(sitemapXml(entries), {
      headers: { ...TEXT_HEADERS, "content-type": "application/xml; charset=utf-8" },
    });
  }

  if (pathname === "/llms.txt") {
    const entries = await fetchRegistry(env);
    return new Response(llmsTxt(entries), { headers: TEXT_HEADERS });
  }

  const skillMatch = SKILL_PAGE_PATH.exec(pathname);
  if (skillMatch && wantsHtml(request)) {
    const [, org, repo] = skillMatch;
    if (org && repo && !RESERVED_SEGMENTS.has(org)) {
      const meta = await fetchSkillMeta(env, org, repo);
      const shellRes = await shell(request, env);
      if (!meta) {
        // A missing/private skill previously returned 200 with the SPA shell —
        // a soft 404 that search engines treat as a site-quality problem. The
        // body is still the SPA, so the client renders its own 404 UI.
        return new Response(shellRes.body, {
          status: 404,
          headers: shellRes.headers,
        });
      }
      return injectSkillPage(shellRes, meta);
    }
  }

  // Landing page: site-level structured data (identical on every render, so
  // it is injected rather than duplicated into index.html).
  if ((pathname === "/" || pathname === "") && wantsHtml(request)) {
    const shellRes = await shell(request, env);
    return new HTMLRewriter()
      .on("head", {
        element(el) {
          el.append(`\n    ${siteJsonLd()}\n  `, { html: true });
        },
      })
      .transform(shellRes);
  }

  return env.ASSETS.fetch(request);
}
