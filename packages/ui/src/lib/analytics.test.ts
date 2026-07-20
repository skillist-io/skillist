// @vitest-environment jsdom
// These exercise cookie + window.dataLayer behaviour, so they need a DOM.
// packages/ui has no vitest config, so the environment is declared per-file.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readConsent, setConsent, track, trackRouterPageviews } from "./analytics";

function clearCookies() {
  for (const c of document.cookie.split(";")) {
    document.cookie = `${c.split("=")[0]?.trim()}=; path=/; max-age=0`;
  }
}

beforeEach(() => {
  clearCookies();
  window.dataLayer = undefined;
});

afterEach(() => {
  window.dataLayer = undefined;
});

describe("track", () => {
  it("no-ops when GTM was never injected", () => {
    // The common case in dev, previews, and for anyone running an ad blocker —
    // call sites must never need to guard.
    expect(() => track("view_item", { item_id: "acme/widget" })).not.toThrow();
    expect(window.dataLayer).toBeUndefined();
  });

  it("pushes the event with its params once a dataLayer exists", () => {
    window.dataLayer = [];
    track("view_item", { item_id: "acme/widget" });
    expect(window.dataLayer[0]).toEqual({ event: "view_item", item_id: "acme/widget" });
  });

  it("drops undefined params rather than sending them as keys", () => {
    window.dataLayer = [];
    track("search", { search_term: "perf", result_count: undefined });
    expect(window.dataLayer[0]).toEqual({ event: "search", search_term: "perf" });
  });
});

describe("consent", () => {
  it("reports no choice before the visitor decides", () => {
    expect(readConsent()).toBeNull();
  });

  it("round-trips a granted choice", () => {
    window.dataLayer = [];
    setConsent("granted");
    expect(readConsent()).toBe("granted");
  });

  it("never grants advertising storage, even on accept", () => {
    // Skillist does not advertise; enabling ad signals would raise the
    // compliance bar for no benefit.
    window.dataLayer = [];
    setConsent("granted");
    const update = window.dataLayer[0] as { consent: Record<string, string> };
    expect(update.consent.analytics_storage).toBe("granted");
    expect(update.consent.ad_storage).toBe("denied");
    expect(update.consent.ad_user_data).toBe("denied");
    expect(update.consent.ad_personalization).toBe("denied");
  });

  it("denies analytics storage when declined", () => {
    window.dataLayer = [];
    setConsent("denied");
    const update = window.dataLayer[0] as { consent: Record<string, string> };
    expect(update.consent.analytics_storage).toBe("denied");
    expect(readConsent()).toBe("denied");
  });
});

describe("trackRouterPageviews", () => {
  it("sends the route pattern, not the resolved path", () => {
    // Skill pages are /{org}/{repo}; reporting raw paths would explode into
    // thousands of GA4 rows.
    window.dataLayer = [];
    let handler: ((p: { toLocation: { pathname: string } }) => void) | undefined;
    const router = {
      subscribe: (_e: "onResolved", cb: typeof handler) => {
        handler = cb;
      },
      state: { matches: [{ routeId: "/$org/$repo" }] },
    };

    trackRouterPageviews(router as never);
    handler?.({ toLocation: { pathname: "/acme/widget" } });

    expect(window.dataLayer[0]).toMatchObject({
      event: "virtual_page_view",
      page_path: "/acme/widget",
      route_id: "/$org/$repo",
    });
  });
});
