# Observability (D10): logs, metrics, traces, SLOs, alert

The API sends OpenTelemetry **traces, metrics and logs** to Grafana Cloud
(free tier). Code: `api/src/telemetry.ts` (SDK + instrumentations),
`api/src/observability.ts` (request metric), `api/src/log.ts` (logs).

| Signal | What | Where to look in Grafana |
| --- | --- | --- |
| Traces | One per request. Spans for the route (Express), **each SQL query** (Postgres, statement text only, no parameter values) and **each Google Books call** (outbound fetch; the API key is in a header, never in the URL). So one trace crosses three components: API → Postgres → Google Books. | Explore → *Tempo* → service `bibliophile-api` |
| Metrics | `bibliophile_http_request_duration_seconds` (histogram) with labels `environment`, `route`, `method`, `status_code`, `status_class`; `bibliophile_google_books_failures_total` by `kind` | The dashboard below |
| Logs | Every JSON log line, also as an OTel log record carrying its `trace_id`: one `request` line per request (route, status, duration, request id), plus warnings and errors | Explore → *Loki* → `{service_name="bibliophile-api"}` |

Health checks (`/healthz`, polled by Render every few seconds) are left out
of traces and metrics so they don't drown real traffic. Route labels come
from a fixed list (`other` for anything else), so random URLs can't create
new metric series.

## Setup (once, about 15 minutes)

1. Sign up at grafana.com (free, no card) and create a stack.
2. In the stack: **Connections → Add new connection → OpenTelemetry (OTLP)**
   → create a token. Do it **twice**: token `bibliophile-staging` and token
   `bibliophile-production`, so each environment has its own secret (D3). The
   page shows `OTEL_EXPORTER_OTLP_ENDPOINT` and
   `OTEL_EXPORTER_OTLP_HEADERS` (`Authorization=Basic%20…`).
3. Render → each API service → **Environment** → add:

   | Variable | Value |
   | --- | --- |
   | `OTEL_EXPORTER_OTLP_ENDPOINT` | from step 2 (e.g. `https://otlp-gateway-prod-us-east-0.grafana.net/otlp`) |
   | `OTEL_EXPORTER_OTLP_HEADERS` | from step 2, **that environment's token** (secret) |
   | `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` |
   | `OTEL_TRACES_EXPORTER` / `OTEL_METRICS_EXPORTER` / `OTEL_LOGS_EXPORTER` | `otlp` (all three) |
   | `OTEL_METRIC_EXPORT_INTERVAL` | `30000` |
   | `DEPLOY_ENV` | `staging` or `production` |

   Saving restarts the service. Its log shows `"msg":"telemetry on"`.
4. **Dashboards → New → Import** → upload
   [`observability/grafana-dashboard.json`](observability/grafana-dashboard.json)
   → pick your stack's Prometheus data source (`grafanacloud-<stack>-prom`).
   Use the `environment` dropdown at the top to switch staging/production.
5. Create the alert (below).

Without `OTEL_EXPORTER_OTLP_ENDPOINT` (local development, tests) the API
sends nothing, and logs only go to the console as before.

## SLIs and SLOs

Measured over all API requests except health checks and unknown routes, per
environment, in a rolling 7-day window.

| | SLI (what we measure) | SLO (target) | Error budget |
| --- | --- | --- | --- |
| Availability | share of requests **not** answered with 5xx | **99%** | 1% of requests. At 1,000 requests/week, 10 may fail |
| Latency | share of requests answered within **500 ms** (the live-updates stream is excluded: it stays open for minutes by design) | **95%** | 5% may be slower |

Why these numbers: 99% fits a single free instance with no redundancy. A
higher target would be a promise the setup can't keep. 500 ms is where a
list page starts to feel slow. **Known budget burner:** the free API sleeps
after 15 minutes idle, and the first request after that waits for about a
minute. Each wake-up counts as a slow request, and sometimes a 5xx at the
platform's proxy, which our own metric doesn't even see. That's the first thing
to fix with money (a paid instance doesn't sleep); see
[cost.md](cost.md).

PromQL (as used by the dashboard, `$environment` = `production`/`staging`):

```promql
# availability, 7 days
1 - (sum(increase(bibliophile_http_request_duration_seconds_count{environment="$environment",status_class="5xx",route!="other"}[7d])) or vector(0))
  / sum(increase(bibliophile_http_request_duration_seconds_count{environment="$environment",route!="other"}[7d]))

# latency: share within 500 ms, 7 days
sum(increase(bibliophile_http_request_duration_seconds_bucket{environment="$environment",route!~"other|/api/events",le="0.5"}[7d]))
  / sum(increase(bibliophile_http_request_duration_seconds_count{environment="$environment",route!~"other|/api/events"}[7d]))
```

## The alert

**Alerting → Alert rules → New alert rule**:

- Name: `Bibliophile API 5xx ratio`
- Query (data source: your Prometheus, *Code* mode):

  ```promql
  sum by (environment) (rate(bibliophile_http_request_duration_seconds_count{status_class="5xx",route!="other"}[5m]))
    / sum by (environment) (rate(bibliophile_http_request_duration_seconds_count{route!="other"}[5m]))
  ```

- Condition: **is above 0.05** (more than 5% of requests failing).
- Evaluation: folder `bibliophile`, group `api` every **1m**, pending
  period **5m**. It fires only when the ratio stays above 5% for 5 minutes,
  so one unlucky request doesn't page anyone.
- No data / error handling: **Normal / OK**. The free API sleeps when idle,
  and silence isn't an outage. The flip side is that this alert can't see a
  process that is completely dead. The Game Day shows whether that matters.
- Contact point: the default email one (your account email).
- Summary annotation: `{{ $labels.environment }}: {{ humanizePercentage $values.A.Value }} of API requests are failing`.

The rule fires per environment. It is meant to fire during the Game Day
([game-day.md](game-day.md)), which is its "alert that fired" evidence.

## Following one request end to end (the trace evidence)

1. `curl -si "https://api.staging.bibliophile.<domain>/api/releases?limit=3" | grep -i x-request-id`
2. Loki: `{service_name="bibliophile-api"} | request_id="<that id>"` →
   the `request` log line → its `trace_id`.
3. Tempo: open that trace id. You see the route span, the SQL spans under it,
   and the time each took. For a curator search (`/api/books/search`) the
   Google Books call is in the same trace.

## Limits

- **One instance, no collector:** the API exports directly to Grafana Cloud.
  If Grafana is unreachable, telemetry is dropped (the API keeps working).
- **Free-tier retention is 14 days**, so the 7-day SLO window fits.
- **Cost of cardinality:** about 11 routes × 2 methods × ~5 status codes × 11
  buckets × 2 environments ≈ 2,400 series at most, plus the instrumentations'
  own metrics, against a free limit of 10,000.
