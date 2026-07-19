/**
 * Absolute URL to a path on the console app (console.skillist.io). On the
 * console app itself `VITE_CONSOLE_URL` is unset, so this stays a same-origin
 * relative path; on the marketing app it's set to the console origin so shared
 * components (e.g. "sign in to run") link across subdomains correctly.
 */
export function consoleUrl(path = ""): string {
  const base = import.meta.env.VITE_CONSOLE_URL ?? "";
  return `${base}${path}`;
}

/**
 * Absolute URL to a path on the marketing app (skillist.io). Unset on the web
 * app itself (stays relative); set on the console so its links to the public
 * skill pages / registry resolve across subdomains.
 */
export function webUrl(path = ""): string {
  const base = import.meta.env.VITE_WEB_URL ?? "";
  return `${base}${path}`;
}
