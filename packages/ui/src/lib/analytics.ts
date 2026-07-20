/**
 * GA4 analytics, delivered via Google Tag Manager.
 *
 * Everything here no-ops when GTM was never injected (dev, preview, or a
 * visitor with an ad blocker), so call sites never need to guard. That last
 * case is not an edge case for this audience: expect a large share of a
 * developer-tool funnel to block googletagmanager.com entirely. Treat GA4 as
 * the acquisition instrument and the server-side telemetry tables as product
 * truth — they will not agree, and the Postgres numbers are the accurate ones.
 */

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

/**
 * Event names. A union rather than free-form strings so a typo is a build
 * error, not a silently-missing metric. GA4 rules: snake_case, ≤40 chars.
 * Standard GA4 names (search, view_item, sign_up, login) are reused where one
 * exists so the built-in reports populate.
 */
export type AnalyticsEvent =
  | "search"
  | "view_item"
  | "sign_up"
  | "login"
  | "registry_filter_apply"
  | "install_snippet_copy"
  | "agent_install_click"
  | "mcp_connect_copy"
  | "skill_star"
  | "sign_in_cta_click"
  | "skill_publish"
  | "skill_run_start"
  | "feedback_submit"
  | "agent_chat_start"
  | "docs_cta_click"
  | "virtual_page_view";

export type AnalyticsParams = Record<string, string | number | boolean | undefined>;

function push(payload: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  // Absent when GTM did not load. Pushing to a dataLayer GTM later adopts is
  // harmless, but there is nothing to gain by queueing indefinitely.
  if (!Array.isArray(window.dataLayer)) return;
  window.dataLayer.push(payload);
}

/** Record a product event. Silently no-ops without GTM. */
export function track(event: AnalyticsEvent, params: AnalyticsParams = {}): void {
  const clean: AnalyticsParams = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) clean[key] = value;
  }
  push({ event, ...clean });
}

/**
 * Fire a virtual pageview on SPA navigation.
 *
 * `onResolved` (not onBeforeNavigate) so aborted navigations are not counted.
 * `route_id` carries the route *pattern* rather than the resolved path: skill
 * pages are /{org}/{repo}, so reporting on raw paths would explode into
 * thousands of distinct GA4 rows and make the page report useless. Register
 * route_id as a custom dimension in the GA4 UI.
 */
type MinimalRouter = {
  subscribe: (
    event: "onResolved",
    cb: (payload: { toLocation: { pathname: string; searchStr?: string } }) => void,
  ) => void;
  state: { matches: { routeId: string }[] };
};

export function trackRouterPageviews(router: MinimalRouter): void {
  router.subscribe("onResolved", ({ toLocation }) => {
    track("virtual_page_view", {
      page_path: `${toLocation.pathname}${toLocation.searchStr ?? ""}`,
      page_title: typeof document === "undefined" ? undefined : document.title,
      route_id: router.state.matches.at(-1)?.routeId,
    });
  });
}

// ---------------------------------------------------------------------------
// Consent (Google Consent Mode v2)
// ---------------------------------------------------------------------------

export const CONSENT_COOKIE = "skillist-consent";
export type ConsentChoice = "granted" | "denied";

/** Reads the stored choice. Absent means the visitor has not decided yet. */
export function readConsent(): ConsentChoice | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)skillist-consent=([^;]*)/);
  const value = match?.[1] ? decodeURIComponent(match[1]) : null;
  return value === "granted" || value === "denied" ? value : null;
}

/**
 * Persists the choice and signals Consent Mode.
 *
 * The consent *default* is denied and is set in the inline GTM bootstrap before
 * the container loads (see the Vite plugin) — this only ever sends the update,
 * so analytics storage is never used before an explicit grant.
 */
export function setConsent(choice: ConsentChoice): void {
  if (typeof document === "undefined") return;
  // Shared across skillist.io and console.skillist.io so the decision is made
  // once; 6 months is a common CMP default.
  const maxAge = 60 * 60 * 24 * 180;
  const domain = location.hostname.endsWith("skillist.io") ? "; domain=.skillist.io" : "";
  document.cookie = `${CONSENT_COOKIE}=${choice}; path=/; max-age=${maxAge}; SameSite=Lax${domain}${
    location.protocol === "https:" ? "; Secure" : ""
  }`;

  push({
    event: "consent_update",
    consent: {
      analytics_storage: choice,
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    },
  });
}
