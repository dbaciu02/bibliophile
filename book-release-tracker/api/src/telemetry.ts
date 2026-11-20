/**
 * OpenTelemetry bootstrap (D10). Loaded BEFORE the app, with
 *   node --import ./dist/telemetry.js dist/server.js
 * so the instrumentations can hook node:http, Express, pg and fetch before
 * anything imports them.
 *
 * Off unless OTEL_EXPORTER_OTLP_ENDPOINT is set (local dev and tests send
 * nothing). Where the data goes, and the credentials, come from the standard
 * OTEL_* environment variables (Grafana Cloud's "OpenTelemetry" connection
 * page generates them; see docs/observability.md).
 *
 * What is recorded:
 * - traces: one span per incoming request (route, status), a child span per
 *   SQL query (statement text only, never the parameter values), and a child
 *   span per call to Google Books (the API key is in a header, not the URL);
 * - metrics: request duration by route and status (src/observability.ts);
 * - logs: every structured log line (src/log.ts), tagged with its trace id.
 */
import { register } from "node:module";

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (endpoint) {
  // ESM: let the instrumentations patch modules as they are imported.
  register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);

  const { startNodeSdk } = await import("@opentelemetry/sdk-node");
  const { HttpInstrumentation } = await import("@opentelemetry/instrumentation-http");
  const { ExpressInstrumentation, ExpressLayerType } = await import("@opentelemetry/instrumentation-express");
  const { PgInstrumentation } = await import("@opentelemetry/instrumentation-pg");
  const { UndiciInstrumentation } = await import("@opentelemetry/instrumentation-undici");

  // Health checks run every few seconds; they'd drown the real traffic.
  const isHealthCheck = (url: string | undefined) => url === "/healthz" || url?.startsWith("/healthz?") === true;

  const sdk = startNodeSdk({
    resourceAttributes: {
      "service.name": "bibliophile-api",
      "service.version": process.env.GIT_SHA ?? "unknown",
      "deployment.environment.name": process.env.DEPLOY_ENV ?? "development",
    },
    instrumentations: [
      new HttpInstrumentation({ ignoreIncomingRequestHook: (req) => isHealthCheck(req.url) }),
      // Router and handler spans only: one span per middleware would use up the free tier's quota.
      new ExpressInstrumentation({ ignoreLayersType: [ExpressLayerType.MIDDLEWARE] }),
      new PgInstrumentation({ enhancedDatabaseReporting: false }), // no query parameter values in spans
      new UndiciInstrumentation(),
    ],
  });

  // server.ts calls this during graceful shutdown, so the last batch is sent.
  (globalThis as { __telemetryShutdown?: () => Promise<void> }).__telemetryShutdown = () => sdk.shutdown();
  console.log(
    JSON.stringify({ level: "info", msg: "telemetry on", endpoint: new URL(endpoint).host, environment: process.env.DEPLOY_ENV ?? "development" }),
  );
}
