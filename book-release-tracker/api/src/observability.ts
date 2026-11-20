import { metrics } from "@opentelemetry/api";
import type { RequestHandler } from "express";
import { log } from "./log.js";

/**
 * Per-request metric and access log (D10).
 *
 * Metric `bibliophile.http.request.duration` (seconds, histogram) with
 * attributes environment, route, method, status_code and status_class
 * ("2xx", "5xx", …). In Grafana Cloud (Prometheus naming) it appears as
 * bibliophile_http_request_duration_seconds_{bucket,count,sum}.
 * The SLIs in docs/observability.md are computed from it:
 *   availability = share of requests that are not 5xx
 *   latency      = share of requests answered within 500 ms
 * The live-updates stream (/api/events) stays open for minutes by design, so
 * it is labelled but excluded from the latency SLI by the dashboard queries.
 */
const meter = metrics.getMeter("bibliophile-api");
// Also a metric label (not only a resource attribute), so dashboards can
// filter by environment with a plain label matcher.
const environment = process.env.DEPLOY_ENV ?? "development";
const duration = meter.createHistogram("bibliophile.http.request.duration", {
  unit: "s",
  description: "Time to answer an API request, by route and status",
  advice: { explicitBucketBoundaries: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30] },
});

/** Every real route, as a template. Anything else is labelled "other". */
const ROUTES = new Set([
  "/api/releases",
  "/api/releases/:id",
  "/api/releases/import",
  "/api/books/search",
  "/api/events",
  "/api/me",
  "/api/me/watchlist",
  "/api/me/watchlist/:id",
  "/mcp",
  "/.well-known/oauth-protected-resource/mcp",
  "/.well-known/oauth-authorization-server",
]);

/**
 * A low-cardinality route label: numeric ids become ":id", and any path that
 * isn't a real route becomes "other". (A scanner probing random URLs then
 * can't create thousands of metric series.)
 */
export function routeLabel(path: string): string {
  const clean = (path.split("?")[0] ?? "/").replace(/\/+$/, "") || "/";
  const template = clean.replace(/\/\d+(?=\/|$)/g, "/:id");
  return ROUTES.has(template) ? template : "other";
}

export const observeRequests: RequestHandler = (req, res, next) => {
  if (req.path === "/healthz") return next();
  const start = process.hrtime.bigint();
  const route = routeLabel(req.path);
  res.on("close", () => {
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    const status = res.statusCode;
    duration.record(seconds, {
      environment,
      route,
      method: req.method,
      status_code: status,
      status_class: `${Math.floor(status / 100)}xx`,
    });
    log(status >= 500 ? "error" : "info", "request", {
      method: req.method,
      route,
      status,
      duration_ms: Math.round(seconds * 1000),
      request_id: res.locals.requestId,
    });
  });
  next();
};
