import { isSpanContextValid, logs, SeverityNumber, trace, type AttributeValue } from "@opentelemetry/api";

/**
 * Structured logging (D10). Every line is one JSON object on stdout/stderr
 * (what Render shows), carrying the trace id of the request it belongs to, and
 * is also sent as an OpenTelemetry log record when telemetry is on, so a log
 * line in Grafana links straight to its trace.
 *
 * Never pass secrets, tokens or personal data in `fields`.
 */
type Level = "info" | "warn" | "error";
const SEVERITY: Record<Level, SeverityNumber> = {
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};
const otelLogger = logs.getLogger("bibliophile-api");

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const span = trace.getActiveSpan()?.spanContext();
  const ids = span && isSpanContextValid(span) ? { trace_id: span.traceId, span_id: span.spanId } : {};
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields, ...ids });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  const attributes: Record<string, AttributeValue> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    attributes[k] = typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : JSON.stringify(v);
  }
  otelLogger.emit({ severityNumber: SEVERITY[level], severityText: level.toUpperCase(), body: msg, attributes });
}
