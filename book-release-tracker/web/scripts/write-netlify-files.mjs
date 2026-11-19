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

/
  Cache-Control: public, max-age=0, must-revalidate
`;

// Single-page app: any path that isn't a file gets index.html (status 200),
// so /watchlist or /auth/callback work on a fresh load.
const redirects = `/*  /index.html  200
`;

writeFileSync(`${dist}_headers`, headers);
writeFileSync(`${dist}_redirects`, redirects);
console.log(`wrote dist/_headers and dist/_redirects (API: ${api || "same origin"})`);
