import { describe, expect, it } from "vitest";
import { withSecurityHeaders, withShellCacheControl } from "./worker-headers";

/**
 * The response-header seams between this Worker and `public/_headers`. Both
 * regressions covered here shipped silently: nothing failed, the headers were
 * just wrong on every response in production.
 */

const STRICT_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com";

describe("withSecurityHeaders", () => {
  it("keeps the stricter policy an asset response already carries", () => {
    // Asset responses arrive with the `_headers` CSP applied. Overwriting it
    // replaced a real default-src/script-src policy with the four-directive
    // fallback, so the strict CSP never reached a browser.
    const res = withSecurityHeaders(
      new Response("<!doctype html>", { headers: { "content-security-policy": STRICT_CSP } }),
    );
    expect(res.headers.get("content-security-policy")).toBe(STRICT_CSP);
  });

  it("supplies the fallback policy when there is none", () => {
    // Worker-rendered responses (robots.txt, sitemap.xml, llms.txt) never pass
    // through the asset server, so nothing else would set these.
    const res = withSecurityHeaders(new Response("User-agent: *"));
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("preserves status and body", async () => {
    const res = withSecurityHeaders(new Response("not found", { status: 404 }));
    expect(res.status).toBe(404);
    await expect(res.text()).resolves.toBe("not found");
  });
});

describe("withShellCacheControl", () => {
  it("marks the shell no-cache", () => {
    const res = withShellCacheControl(new Response("<!doctype html>"));
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("replaces rather than appends", () => {
    // The bug this guards against: `no-cache` and the immutable directive both
    // landing on one response, where `no-cache` wins and every hashed asset is
    // revalidated on each load.
    const res = withShellCacheControl(
      new Response("<!doctype html>", {
        headers: { "Cache-Control": "public, max-age=31536000, immutable" },
      }),
    );
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
  });
});
