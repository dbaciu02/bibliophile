# D10, D11, S2 — Observability, cost, runbook and Game Day evidence

Setup: [observability.md](../observability.md), [cost.md](../cost.md),
[runbook.md](../runbook.md), [game-day.md](../game-day.md).
date `11-22 & 11-23 & 11-24-2026`.

## D10 — OpenTelemetry logs, metrics, a trace across components, SLI/SLO, an alert that fired

1. **Telemetry is on:** Render → each service → Logs: the
   `"msg":"telemetry on"` line. 
Screenshots: [docs/evidence/screenshots/D10-api-telemetry.png](../evidence/screenshots/D10-api-telemetry.png) &
[docs/evidence/screenshots/D10-staging-telemetry.png](../evidence/screenshots/D10-staging-telemetry.png)

2. **Dashboard** with real traffic (run `scripts/traffic.sh <api> 10` first if
   it's quiet): 
Screenshot: [docs/evidence/screenshots/D10-SLO-prod.png](../evidence/screenshots/D10-SLO-prod.png)

3. **One trace across ≥ 2 components:** as a Test Curator on staging, search
   in Curate. Then follow
   [observability.md → "Following one request end to end"](../observability.md#following-one-request-end-to-end-the-trace-evidence):
   - request id: `b8fa5c8f-22a7-4a31-bbf1-972f014b1606`
   - trace id: `18bfd9cc53c0f01eb8735be6da87aa62`
   - [docs/evidence/screenshots/D10-api-trace.png](../evidence/screenshots/D10-api-trace.png)
   - [docs/evidence/screenshots/D10-api-logs.png](../evidence/screenshots/D10-api-logs.png)

4. **SLI/SLO:** defined in [observability.md](../observability.md#slis-and-slos);
   current values from the dashboard: availability `100%`, fast-request share `100%`, error budget left `100%`.

5. **The alert that fired:** during the Game Day. *(screenshots: the rule   in Firing state, the email, and the rule back to Normal)*

6. **No secrets in telemetry:** search Loki and Tempo for your Google key's
   first 8 characters and for `Bearer`. 
   [docs/evidence/screenshots/D10-loki-nosecrets1.png](../evidence/screenshots/D10-loki-nosecrets1.png) <br>
   [docs/evidence/screenshots/D10-loki-nosecrets2.png](../evidence/screenshots/D10-loki-nosecrets2.png) <br>
   [docs/evidence/screenshots/D10-tempo-nosecrets1.png](../evidence/screenshots/D10-tempo-nosecrets1.png)<br>
   [docs/evidence/screenshots/D10-tempo-nosecrets2.png](../evidence/screenshots/D10-tempo-nosecrets2.png)
   


## D11 — Free tier / budget guards, cost at 1×, 10×, 100×
- Cost table with arithmetic: [cost.md](../cost.md).
- Screenshots of each guard listed in [cost.md → Budget and free-tier guards](../cost.md#budget-and-free-tier-guards-the-d11-evidence),
  and the Google Cloud budget alert if you created one.
- Current usage this month (Netlify credits used, Render free hours used):
  151.8 credits used on Netlify and 46.9 free hours used on Render.

## S2 — Runbook and Game Day

- Runbook: [runbook.md](../runbook.md). Did you use it during the Game Day?
  Which section? Was anything missing? 
  I used the runbook for the database down reversal during the Game Day.
- Game Day plan and **your postmortem**: [game-day.md](../game-day.md).
