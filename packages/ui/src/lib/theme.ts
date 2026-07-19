export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "skillist-theme";
const ONE_YEAR = 60 * 60 * 24 * 365;

// Persist the theme in a cookie (not localStorage) so it is shared across the
// marketing (skillist.io) and console (console.skillist.io) apps — different
// origins that don't share localStorage. On skillist.io hosts the cookie is
// scoped to the parent domain; on localhost it's host-only (still shared across
// ports, which cookies ignore). Must match the anti-flash script in each app's
// index.html.
function cookieDomainAttr(): string {
  if (typeof window === "undefined") return "";
  return window.location.hostname.endsWith("skillist.io") ? "; domain=.skillist.io" : "";
}

function readThemeCookie(): string | null {
  if (typeof document === "undefined") return null;
  const value = document.cookie.match(/(?:^|;\s*)skillist-theme=([^;]*)/)?.[1];
  return value != null ? decodeURIComponent(value) : null;
}

export function getStoredTheme(): Theme {
  // Dark is the default: a visitor with no stored preference gets dark
  // regardless of OS setting. "light" and "system" remain explicit opt-ins.
  if (typeof window === "undefined") return "dark";
  const stored = readThemeCookie();
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  return "dark";
}

export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

export function applyTheme(theme: Theme) {
  const resolved = resolveTheme(theme);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.style.colorScheme = resolved;
}

export function setStoredTheme(theme: Theme) {
  document.cookie = `${STORAGE_KEY}=${theme}; path=/; max-age=${ONE_YEAR}; samesite=lax${cookieDomainAttr()}`;
  applyTheme(theme);
}
