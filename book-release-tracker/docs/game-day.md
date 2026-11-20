# Game Day (S2): staging loses its database login

A planned, deliberate failure on **staging**, observed with the real
monitoring, recovered with the [runbook](runbook.md), and written up as a
blameless postmortem. Plan below (prepared in advance); everything under
"Postmortem" is yours to fill in from what actually happened.

## Plan

**Scenario.** The staging API's database login stops working, as if its
password were rotated without updating the app, or the database refused it.
Production uses the same Postgres instance with its own login, so this also
tests that one environment's failure stays out of the other (D3).

**Why this one.** It is the most likely real outage for this setup (a shared
free database, credentials pasted by hand), it is fully reversible in one
command, and it exercises every piece of step 9: the 5xx metric, the SLO
dashboard, the alert, logs, traces and the runbook.

**Before you start (15 min):**

- [ ] The alert from [observability.md](observability.md) exists, and you can receive its email.
- [ ] Grafana dashboard open, `environment` = **staging**, time range "Last 30 minutes".
- [ ] A second tab: Render → `bibliophile-api-staging` → Logs.
- [ ] Terminal 1, the admin connection (Render → `bibliophile-db` → External URL):
      `export ADMIN_URL='…'`
- [ ] Terminal 2, steady traffic: `scripts/traffic.sh https://api.staging.bibliophile.<domain> 30`
- [ ] Terminal 3, production watch:
      `while true; do date +%T; curl -s https://api.bibliophile.<domain>/healthz; echo; sleep 30; done`
- [ ] Write down your **prediction** in the postmortem (what will the user see, what will the
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

**What to capture:** traffic.sh output (before/during/after), dashboard
screenshot covering the whole window, the alert in *Firing* state and its
email, one error log line and the trace id of a failing request, the
production watch output, and Render's Events for staging.

---

## Postmortem

*Blameless: describe what the system and the process did, not who erred.*

**Date / times (with time zone):** _____

**Summary (2–3 sentences):** _____

**Prediction (written before injecting):** _____

**Impact:** who/what was affected, for how long; staging requests failed
(from traffic.sh: ___ of ___); production affected? _____

**Timeline:**

| Time | What happened / what I saw | Source (traffic.sh, dashboard, logs, email…) |
| --- | --- | --- |
| | Injected: `ALTER ROLE … NOLOGIN` | terminal 1 |
| | | |
| | Alert fired | email / Alerting page |
| | Recovered: `ALTER ROLE … LOGIN` | terminal 1 |
| | Back to all 200s | traffic.sh |
| | Alert resolved | |

**Detection:** how was it noticed, and how long after the injection? Did the
alert fire, after how long, and was that fast enough? _____

**What the system did:** what did the API return, what did `/healthz` say,
did Render restart the service, did it recover by itself after the fix? _____

**Root cause:** _____

**Prediction vs reality:** what surprised you? _____

**What went well:** _____

**What went badly / was hard:** _____

**Action items** (each with an owner and whether you did it):

| Action | Why | Done? |
| --- | --- | --- |
| | | |

**Evidence:** links/paths to the screenshots and outputs captured above,
the commit SHA running on staging (`curl …/healthz`), and the trace id.
