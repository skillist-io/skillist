const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

/** Full URL to the API origin (for docs, SKILL.md, external links). */
export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!API_BASE) return normalized;
  return `${API_BASE}${normalized}`;
}
