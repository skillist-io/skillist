/**
 * Base URL for credentialed browser fetches.
 * Production uses same-origin paths (skillist.io/api, /v1) so session cookies
 * set during OAuth are first-party. Local dev proxies those paths via Vite.
 */
export function clientFetchBase(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
}
