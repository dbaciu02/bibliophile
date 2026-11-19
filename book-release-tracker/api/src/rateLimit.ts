import type { RequestHandler } from "express";
import { HttpError } from "./errors.js";

/**
 * Small fixed-window rate limiter (S1). Keyed by the signed-in user when there
 * is one, otherwise by client IP. In-memory, so each server instance counts on
 * its own. The deployment runs one API instance per environment, so the
 * limits hold as written; with more instances each would allow the full limit
 * (a shared store such as Redis would be the fix).
 *
 * On limit: 429 with Retry-After and the standard error shape.
 */
export function rateLimit(opts: {
  name: string;
  limit: number;
  windowMs: number;
  now?: () => number;
  /** Who to count; defaults to the signed-in user, else the client IP. */
  key?: (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) => string | undefined;
}): RequestHandler {
  const now = opts.now ?? Date.now;
  const windows = new Map<string, { start: number; count: number }>();

  return (req, res, next) => {
    const who = opts.key?.(req, res) ?? res.locals.principal?.subject ?? req.ip ?? "unknown";
    const key = `${opts.name}:${who}`;
    const t = now();

    let w = windows.get(key);
    if (!w || t - w.start >= opts.windowMs) {
      w = { start: t, count: 0 };
      windows.set(key, w);
    }
    w.count += 1;

    // Drop expired windows now and then so the map can't grow without bound.
    if (windows.size > 10_000) {
      for (const [k, v] of windows) if (t - v.start >= opts.windowMs) windows.delete(k);
    }

    const remaining = Math.max(0, opts.limit - w.count);
    res.set("RateLimit-Limit", String(opts.limit));
    res.set("RateLimit-Remaining", String(remaining));

    if (w.count > opts.limit) {
      const retryAfter = Math.ceil((w.start + opts.windowMs - t) / 1000);
      res.set("Retry-After", String(retryAfter));
      throw new HttpError(429, "rate_limited", `Too many requests; try again in ${retryAfter} s`);
    }
    next();
  };
}
