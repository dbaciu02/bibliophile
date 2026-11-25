# Game Day (S2): staging loses its database login

A planned, deliberate failure on **staging**, observed with the real
monitoring, recovered with the [runbook](runbook.md), and written up as a
blameless postmortem.

## Plan

**Scenario.** The staging API's database login stops working, as if its
password were rotated without updating the app, or the database refused it.
Production uses the same Postgres instance with its own login, so this also
tests that one environment's failure stays out of the other (D3).

**Before you start (15 min):**

- [x] The alert from [observability.md](observability.md) exists, and you can receive its email.
- [x] Grafana dashboard open, `environment` = **staging**, time range "Last 30 minutes".
- [x] A second tab: Render → `bibliophile-api-staging` → Logs.
- [x] Terminal 1, the admin connection (Render → `bibliophile-db` → External URL):
      `export ADMIN_URL='…'`
- [x] Terminal 2, steady traffic: `scripts/traffic.sh https://api.staging.bibliophile.<domain> 30`
- [x] Terminal 3, production watch:
      `while true; do date +%T; curl -s https://api.bibliophile.<domain>/healthz; echo; sleep 30; done`
- [x] Write down your **prediction** in the postmortem (what will the user see, what will the
      dashboard show, will the alert fire and when) **before** injecting.

**Inject (note the exact time):**

```bash
psql "$ADMIN_URL" -c "ALTER ROLE bibliophile_staging NOLOGIN" \
  -c "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE usename = 'bibliophile_staging'"
```

**Observe for ~10 minutes** (the alert needs 5 minutes above 5% to fire):
traffic.sh output, staging `/healthz`, the dashboard (5xx ratio,
availability), Render logs and events, the alert state (Alerting → Alert
rules), your email, the staging site in a browser, and production staying
green in terminal 3.

**Abort criteria:** production `/healthz` stops answering `ok`, or anything
looks wrong outside staging → recover immediately (below).

**Recover, following the runbook ("Database down"):**

```bash
psql "$ADMIN_URL" -c "ALTER ROLE bibliophile_staging LOGIN"
curl -s https://api.staging.bibliophile.<domain>/healthz
```

Note the time traffic.sh shows all 200s again, and when the alert resolves.
`unset ADMIN_URL` afterwards.

---

## Postmortem

*Blameless: describe what the system and the process did, not who erred.*

**Date / times (with time zone):** 11-24-2026 12:19 PM

**Summary (2–3 sentences):** Caused staging database to become temporarily unavailable by revoking login for the `bibliophile_staging` role, resulting in failed requests on the staging site while production remained unaffected.

**Prediction (written before injecting):** The user will see errors on the staging site, the dashboard will show increased 5xx ratios and decreased availability, and the alert will fire within 5 minutes of the injection.

**Impact:** who/what was affected, for how long; staging requests failed for for ~15 minutes and users experienced errors; production affected? No

**Timeline:**
Initially at 12:22 pm, I altered the `bibliophile_staging` role to revoke login by running `ALTER ROLE bibliophile_staging NOLOGIN` in the staging database. Traffic showed 429 responses, indicating rate limiting or failed requests due to the revoked login. The alert gave me a false alarm at 12:05 then an actual alert at 12:26.
The dashboard reflected the increased 5xx ratios and decreased availability during this period. (didn't capture a screenshot at the exact moment, but the trend is visible in the dashboard history). Stopped traffic at 12:37 pm by restoring login for the `bibliophile_staging` role with `ALTER ROLE bibliophile_staging LOGIN`. Traffic returned to normal shortly after. I fixed the alert error handling by setting normal for both no-data and error states. The second time, I restarted traffic and injected again 12:56 pm. Traffic showed similar failed requests, but the alert fired at 12:33 pm. It then fired resolve at 12:59 pm. The threshold remained below 0.05 so the alert did not trigger again. In both, the system recovered after restoring login as well as production remained the unaffected. I altered login back to normal afterwards.

**What the system did:** what did the API return, what did `/healthz` say,
did Render restart the service, did it recover by itself after the fix? 
API returned 429 for staging requests while production remained unaffected. `/healthz` endpoint returned 200 for production. Render did not restart the service automatically; it recovered after restoring login for the `bibliophile_staging` role. 

**Root cause:** The staging database became temporarily unavailable because the login for the `bibliophile_staging` role was revoked, causing failed requests on the staging site.

**Prediction vs reality:** what surprised you? 
I was surprised that the alert fired a false "no data" alert before the actual outage and that the system did not automatically recover without restoring the login for the `bibliophile_staging` role. I think the system handled the outage better in the intial run than the second injection, likely due to the changes made to the alert's error handling settings.

**What went well:** 
The system correctly identified the outage on the staging site and fired the resolved alert as expected. The recovery process worked as intended once the login for the `bibliophile_staging` role was restored. Additionally, production remained unaffected throughout the incident.

**What went badly / was hard:** At 12:05 I got a false "no data" alert, and injected at 12:22. Then at 12:26 the "resolved" email (caused by the outage starting). What happened was the the alert's no-data setting wasn't set as planned, so it alarmed when all was well and "resolved" when the outage began. I changed the error handling from No data to Normal.

**Evidence:** 
- one of many trace ids from the failed requests on staging: "60595eee40c4855e4ef1dadcd768cdb2"
<!--add all GD screenshots from screenshot folder-->
[GD-alert-12:59.png](evidence/screenshots/GD-alert-12:59.png)<br>
[GD-alert-1205.png](evidence/screenshots/GD-alert-1205.png)<br>
[GD-alert-1226.png](evidence/screenshots/GD-alert-1226.png)<br>
[GD-alert-1233.png](evidence/screenshots/GD-alert-1233.png)<br>
[GD-alert-dashboard.png](evidence/screenshots/GD-alert-dashboard.png)<br>
[GD-alertchange.png](evidence/screenshots/GD-alertchange.png)<br>
[GD-alertdashboard-run2.png](evidence/screenshots/GD-alertdashboard-run2.png)<br>
[GD-logs-run1.png](evidence/screenshots/GD-logs-run1.png)<br>
[GD-prod-run2.png](evidence/screenshots/GD-prod-run2.png)<br>
[GD-production.png](evidence/screenshots/GD-production.png)<br>
[GD-render-eventlog.png](evidence/screenshots/GD-render-eventlog.png)<br>
[GD-render-recover.png](evidence/screenshots/GD-render-recover.png)<br>
[GD-renderlog-run2.png](evidence/screenshots/GD-renderlog-run2.png)<br>
[GD-slo-dashboard.png](evidence/screenshots/GD-slo-dashboard.png)<br>
[GD-traffic-resolved-run2.png](evidence/screenshots/GD-traffic-resolved-run2.png)<br>
[GD-traffic-run1.png](evidence/screenshots/GD-traffic-run1.png)<br>
[GD-traffic-run2.png](evidence/screenshots/GD-traffic-run2.png)<br>




