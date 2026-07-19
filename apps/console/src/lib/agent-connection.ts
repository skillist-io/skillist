/**
 * WebSocket host for the per-org Skillist Agent (an `AIChatAgent` Durable
 * Object routed at `/agents/skillist-agent/{orgId}` on the API worker).
 *
 * We connect **same-origin** by default: both surfaces proxy `/agents/*` to the
 * API worker —
 *   - dev: a Vite `ws: true` proxy to `:8787` (see `vite.config.ts`)
 *   - prod: the console worker's service binding to the API (`src/worker.ts`)
 * so the Better Auth session cookie (`.skillist.io`) rides the handshake as a
 * first-party cookie. No cross-origin host, no token exchange.
 *
 * If `VITE_API_URL` is ever set (a direct cross-origin build), we fall back to
 * that host — cross-subdomain cookies are same-site, so the handshake still
 * carries credentials.
 */
export function agentHost(): string | undefined {
  const explicit = import.meta.env.VITE_API_URL as string | undefined;
  if (explicit) {
    try {
      return new URL(explicit).host;
    } catch {
      return undefined;
    }
  }
  return undefined; // same-origin (proxied)
}
