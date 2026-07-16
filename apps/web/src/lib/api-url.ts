import { clientFetchBase } from "./client-api-base";

const EXTERNAL_API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

/** Absolute URL for display / external links (API docs, etc.). */
export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = EXTERNAL_API_BASE || clientFetchBase();
  if (!base) return normalized;
  return `${base}${normalized}`;
}

/** Same-origin URL for credentialed browser fetches in production. */
export function fetchApiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${clientFetchBase()}${normalized}`;
}
