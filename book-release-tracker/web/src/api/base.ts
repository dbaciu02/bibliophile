/**
 * Where the API lives.
 *
 * - Development: empty, so requests go to the same origin and Vite's proxy
 *   forwards /api to localhost:3000 (no CORS involved).
 * - Staging/production: VITE_API_BASE_URL, e.g. https://api.bibliophile.example.com.
 *   The site and the API are separate origins, so the API's CORS allowlist
 *   must name the site's exact origin (D7).
 *
 * Public (it ends up in the bundle), like every VITE_ value.
 */
const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";

function checkBase(value: string): string {
  if (value === "") return "";
  const u = new URL(value); // throws on garbage at startup, not on first request
  if (u.origin !== value) throw new Error(`VITE_API_BASE_URL must be an origin like https://api.example.com (got ${value})`);
  return value;
}

export const API_BASE_URL = checkBase(raw);

/** "/api/releases?x=1" -> "https://api.example.com/api/releases?x=1" (or unchanged in dev). */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}
