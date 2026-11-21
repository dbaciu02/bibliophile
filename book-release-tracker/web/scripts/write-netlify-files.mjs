// Writes dist/_headers and dist/_redirects for Netlify after `vite build`.
//
// They are generated (not static files in public/) because the CSP must name
// the API origin of the environment being built: staging and production talk
// to different APIs. Inputs are the same public VITE_* values as the bundle.
//
// Cache policy per content class (D6):
//   /assets/*   hashed file names -> cache for a year, never revalidate
//   HTML        always revalidate (ETag -> 304), so a deploy shows at once
//   anything else: Netlify's default (public, max-age=0, must-revalidate)
//   /api/releases* public catalog reads, proxied to the API (same origin) so
//               Netlify's CDN can keep them; the API's Netlify-CDN-Cache-Control
//               says for how long (60 s). /api/events and every personal route
//               are NOT proxied: the browser calls the API origin directly.
// Cache-Control is set only on specific paths: Netlify merges values when two
// rules match one path, so a catch-all value would collide with /assets/*.
// Nothing personalized is served from here: user data comes from the API,
// which marks it `private, no-store`.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const api = (process.env.VITE_API_BASE_URL ?? "").trim();
if (api && new URL(api).origin !== api) throw new Error(`VITE_API_BASE_URL must be an origin, got ${api}`);
if (process.env.CI && !api.startsWith("https://")) throw new Error("VITE_API_BASE_URL must be set to an https origin for a deploy build");

const LOGIN = "https://login.microsoftonline.com";
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https://books.google.com",
  `connect-src 'self' ${api} ${LOGIN}`.replace(/\s+/g, " ").trim(),
  `frame-src ${LOGIN}`, // oidc-client-ts silent renew falls back to an iframe without a refresh token
  `form-action 'self' ${LOGIN}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const headers = `/*
  Content-Security-Policy: ${csp}
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/index.html
  Cache-Control: public, max-age=0, must-revalidate

/version.json
  Cache-Control: no-cache

/
  Cache-Control: public, max-age=0, must-revalidate
`;

// D6 proxy rules come first (Netlify uses the first rule that matches).
// Writes to /api/releases still go straight to the API origin from the app;
// if one did arrive here it is forwarded unchanged, and the API still checks
// the token and role.
const proxy = api
  ? `/api/releases    ${api}/api/releases    200
/api/releases/*  ${api}/api/releases/:splat  200
`
  : "";
// Single-page app: any path that isn't a file gets index.html (status 200),
// so /watchlist or /auth/callback work on a fresh load.
const redirects = `${proxy}/*  /index.html  200
`;

// Which commit this build came from. The pipeline reads it from the live
// site to decide whether the site needs redeploying (D11: deploys cost credits).
const commit = process.env.BUILD_COMMIT ?? process.env.GITHUB_SHA ?? "local";
writeFileSync(`${dist}version.json`, `${JSON.stringify({ commit })}\n`);

writeFileSync(`${dist}_headers`, headers);
writeFileSync(`${dist}_redirects`, redirects);
console.log(`wrote dist/_headers, dist/_redirects and dist/version.json (API: ${api || "same origin"}, CDN proxy: ${api ? "on" : "off"}, commit: ${commit})`);
