# D10, D11, S2 — Observability, cost, runbook and Game Day evidence

Setup: [observability.md](../observability.md), [cost.md](../cost.md),
[runbook.md](../runbook.md), [game-day.md](../game-day.md).
Commit `_______`, date `_______`.

## D10 — OpenTelemetry logs, metrics, a trace across components, SLI/SLO, an alert that fired

1. **Telemetry is on:** Render → each service → Logs: the
   `"msg":"telemetry on"` line. *(screenshot)*
2. **Dashboard** with real traffic (run `scripts/traffic.sh <api> 10` first if
   it's quiet): *(screenshot of "Bibliophile API — SLOs", production)*
3. **One trace across ≥ 2 components:** as a Test Curator on staging, search
   in Curate. Then follow
   [observability.md → "Following one request end to end"](../observability.md#following-one-request-end-to-end-the-trace-evidence):
   - request id: `_______`
   - trace id: `_______`
   - *(screenshot of the trace: the route span, SQL spans, the Google Books call)*
   - *(screenshot of the matching log line in Loki)*
4. **SLI/SLO:** defined in [observability.md](../observability.md#slis-and-slos);
   current values from the dashboard: availability `____`, fast-request share `____`.
5. **The alert that fired:** during the Game Day. *(screenshots: the rule
   in Firing state, the email, and the rule back to Normal)*
6. **No secrets in telemetry:** search Loki and Tempo for your Google key's
   first 8 characters and for `Bearer`. *(paste: no results)*

## D11 — Free tier / budget guards, cost at 1×, 10×, 100×

- Cost table with arithmetic: [cost.md](../cost.md).
- Screenshots of each guard listed in [cost.md → Budget and free-tier guards](../cost.md#budget-and-free-tier-guards-the-d11-evidence),
  and the Google Cloud budget alert if you created one.
- Current usage this month (Netlify credits used, Render free hours used):
  `_______`

## S2 — Runbook and Game Day

- Runbook: [runbook.md](../runbook.md). Did you use it during the Game Day?
  Which section? Was anything missing? *(note it here, and fix the runbook)*
- Game Day plan and **your postmortem**: [game-day.md](../game-day.md).
