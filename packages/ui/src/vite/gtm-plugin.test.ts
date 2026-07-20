import { describe, expect, it } from "vitest";
import { gtmPlugin } from "./gtm-plugin";

const SHELL = `<!doctype html><html><head><title>x</title></head><body><div id="root"></div></body></html>`;

function runPlugin(
  env: Record<string, string | undefined>,
  ctx: { server?: unknown } = {},
): string {
  return gtmPlugin(env).transformIndexHtml.handler(SHELL, ctx);
}

describe("gtmPlugin", () => {
  it("injects nothing when VITE_GTM_ID is unset", () => {
    // The default for local builds and previews — they must never load GTM or
    // pollute the GA4 property.
    expect(runPlugin({})).toBe(SHELL);
  });

  it("injects nothing in the dev server even when the id is set", () => {
    expect(runPlugin({ VITE_GTM_ID: "GTM-TEST123" }, { server: {} })).toBe(SHELL);
  });

  it("injects the container when the id is set for a build", () => {
    const out = runPlugin({ VITE_GTM_ID: "GTM-TEST123" });
    expect(out).toContain("googletagmanager.com/gtm.js");
    expect(out).toContain("GTM-TEST123");
    expect(out).toContain("<noscript>");
  });

  it("sets Consent Mode defaults to denied BEFORE loading the container", () => {
    // Ordering is the entire point: a default set after GTM initialises is too
    // late, and analytics_storage would already have been used.
    const out = runPlugin({ VITE_GTM_ID: "GTM-TEST123" });
    const consentAt = out.indexOf("'consent', 'default'");
    const loaderAt = out.indexOf("googletagmanager.com/gtm.js");
    expect(consentAt).toBeGreaterThan(-1);
    expect(consentAt).toBeLessThan(loaderAt);
    expect(out).toContain("analytics_storage: 'denied'");
    expect(out).toContain("ad_storage: 'denied'");
  });
});
