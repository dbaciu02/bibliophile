import type { RequestHandler } from "express";
import { HttpError } from "./errors.js";

/**
 * Security headers on every API response (D7). The API only serves JSON and
 * event streams, so its CSP forbids everything: nothing it returns should
 * ever run as a page. (The website's own headers are in web/netlify.toml.)
 */
export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.set({
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "Cross-Origin-Resource-Policy": "same-site",
  });
  next();
};

const ALLOWED_METHODS = "GET, POST, PATCH, DELETE, OPTIONS";
const ALLOWED_HEADERS = "Authorization, Content-Type, Last-Event-ID, MCP-Protocol-Version, Mcp-Session-Id";
const EXPOSED_HEADERS = "X-Request-Id, Retry-After, RateLimit-Limit, RateLimit-Remaining, WWW-Authenticate, Location";

/**
 * CORS with an allowlist of exact origins (D7): scheme + host + port must
 * match one entry character for character. No wildcards, no suffix matching,
 * no credentials (the API uses bearer tokens, never cookies).
 *
 * - Allowed origin: the response names that origin in
 *   Access-Control-Allow-Origin, so the browser lets the page read it.
 * - Any other origin: no CORS headers at all, so the browser blocks the page
 *   from reading the response; a preflight is refused with 403.
 * - No Origin header (curl, servers, same-origin): nothing to do.
 */
export function cors(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, res, next) => {
    res.vary("Origin");
    const origin = req.get("Origin");
    if (!origin) return next();

    const ok = allowed.has(origin);
    if (ok) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Access-Control-Expose-Headers", EXPOSED_HEADERS);
    }
    if (req.method === "OPTIONS" && req.get("Access-Control-Request-Method")) {
      if (!ok) throw new HttpError(403, "forbidden", `Origin ${origin} is not allowed to call this API`);
      res.set({
        "Access-Control-Allow-Methods": ALLOWED_METHODS,
        "Access-Control-Allow-Headers": ALLOWED_HEADERS,
        "Access-Control-Max-Age": "600",
      });
      res.vary("Access-Control-Request-Method").vary("Access-Control-Request-Headers");
      res.status(204).end();
      return;
    }
    next();
  };
}

/** Parses "https://a.example, https://b.example" into exact origins, rejecting anything that isn't one. */
export function parseOrigins(value: string): string[] {
  const list = value.split(",").map((s) => s.trim()).filter(Boolean);
  for (const o of list) {
    let u: URL;
    try {
      u = new URL(o);
    } catch {
      throw new Error(`CORS_ORIGINS: "${o}" is not a URL`);
    }
    if (u.origin !== o) throw new Error(`CORS_ORIGINS: "${o}" must be an exact origin like https://site.example (no path or trailing slash)`);
  }
  return list;
}
