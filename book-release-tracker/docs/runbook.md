# Runbook (S2)

For someone who has never seen this project and has to keep it running or
fix it. Every step names the exact page or command. Replace `<domain>` with
the domain in the GitHub variable `WEB_URL`.

## What runs where

| Piece | Production | Staging | Dashboard |
| --- | --- | --- | --- |
| Website (static, CDN) | `https://bibliophile.<domain>` | `https://staging.bibliophile.<domain>` | Netlify → projects `bibliophile-…` / `bibliophile-staging-…` |
| API (Docker container) | `https://api.bibliophile.<domain>` | `https://api.staging.bibliophile.<domain>` | Render → `bibliophile-api` / `bibliophile-api-staging` |
| Database | `bibliophile_prod` | `bibliophile_staging` | Render → `bibliophile-db` (one instance, two databases, two logins) |
| Sign-in | Entra ID `booktracker-api` / `booktracker-web` | `…-staging` registrations | entra.microsoft.com → App registrations |
| Book data | Google Books API (key per environment) | | console.cloud.google.com → Credentials |
| Telemetry, alert | Grafana Cloud, dashboard "Bibliophile API — SLOs" | same, `environment` dropdown | grafana.com → your stack |
| Pipeline | GitHub Actions: `deploy` (→ staging), `promote` (→ production), `rollback`, `cert-check`, `purge-cache` (CDN copy of the catalog) | | the repository → Actions |

Secrets and where they live: [secrets.md](secrets.md). Full setup:
[deployment.md](deployment.md).

## First look, whatever the problem

1. **Is it up?** `curl -s https://api.bibliophile.<domain>/healthz`
   - `{"status":"ok","db":"ok","commit":"…"}` → the API and its database are fine. Go to the symptom table.
   - `503` with `{"status":"unavailable","db":"unreachable",…}` → **database** (see "Database down").
   - Takes ~1 minute, then OK → the free instance was **asleep**. Normal, not an incident.
   - No answer or a Render error page → **API down** (see below).
2. **What changed?** GitHub → Actions: the last `deploy` / `promote` run and
   its commit. Render → service → **Events**: deploys, restarts, failed health
   checks. Most incidents follow a change.
3. **What do the logs say?** Render → service → **Logs** (JSON lines; errors
   have `"level":"error"`), or Grafana → Explore → Loki:
   `{service_name="bibliophile-api"} | json | level="error"`.
4. **How bad is it?** Grafana dashboard → availability and 5xx ratio for that
   environment.

## Symptoms and fixes

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Site loads, every list shows "Something went wrong", `/healthz` 503 | Database unreachable or login refused | "Database down" below |
| Site loads, lists fine, "Sign in" fails at Microsoft with `AADSTS50011` | Redirect URI missing for this host | Entra → the web registration → Authentication → add `https://<host>/auth/callback` |
| Signed in, API answers 401 to everything | Token audience/issuer mismatch: wrong `ENTRA_API_CLIENT_ID` / `ENTRA_TENANT_ID` on that Render service (e.g. staging id on production) | Render → service → Environment → correct it (saving redeploys) |
| Browser console: "blocked by CORS policy" | `CORS_ORIGINS` doesn't list the site's exact origin | Render → service → Environment → `CORS_ORIGINS=https://<site host>` (no trailing slash) |
| Browser console: "Refused to connect … Content Security Policy" | Site was built with a different `VITE_API_BASE_URL` | GitHub → Settings → Environments → that environment → `API_URL`, then re-run its deploy |
| Curate search: "Google Books is unavailable right now" | Google down, quota used up (1,000/day), or a bad key | Render logs: `google books failure` lines (`kind`). Quota: Google Cloud → Books API → Quotas. Key: create a new one and update `GOOGLE_BOOKS_API_KEY`. Cached results keep working meanwhile |
| A curator's change doesn't show for someone who **just opened** the page (it shows within a minute) | The catalog is CDN-cached for 60 s (D6). Open pages get changes at once through live updates; a fresh page load can get a copy up to 60 s old | Usually nothing: it expires by itself. If it must show now: Actions → `purge-cache` → the environment. Check with `curl -sI <site>/api/releases?limit=20` → `Cache-Status: … fwd=miss` |
| Catalog on the site errors but `<api>/api/releases` works | The site's proxy rule is missing (site built without `VITE_API_BASE_URL`) or points at the wrong API | Look at the smoke step "catalog through the site's CDN" in the last `deploy` run. Fix `API_URL` in that GitHub environment (Settings → Environments), then re-run the deploy |
| Live pill stays "Reconnecting…" | API restarting or asleep | Wait 1–2 minutes; check `/healthz`. The page reconnects by itself |
| `deploy` run red at "Gate: staging /healthz" | The new build doesn't start (bad code or config) | Render → staging → Logs for the startup error. Staging keeps serving the previous build. Fix, push again |
| `promote` red, summary says "Rolled back" | New build failed its health check in production; the pipeline already restored the previous one | Production is fine. Investigate on staging; don't re-promote that commit |
| `cert-check` red | A certificate expires in < 21 days: automatic renewal failed | Netlify → Domain management → HTTPS → **Renew certificate**; Render → Custom Domains → re-verify. Check the CAA records still allow `letsencrypt.org` and `pki.goog` (`dig CAA <domain>`) |
| Pushing images fails: "storage limit" | GitHub Packages free storage (500 MB) full | GitHub → your profile → Packages → `bibliophile-api` → delete old versions (keep the last 10) |
| Website deploy fails: credits exhausted | Netlify used this month's plan credits | Netlify → Billing: buy a credit pack or wait for the new cycle; the site already deployed keeps serving |

## Database down

1. Render → `bibliophile-db`. Status **Available**?
   - **Suspended / expired:** the free database lasts 30 days. Upgrade it
     (Basic-256mb) within the 14-day grace period, or the data is deleted.
   - **Available:** a login problem. From a terminal with the admin URL:
     `psql "$ADMIN_URL" -c "select rolname, rolcanlogin from pg_roles where rolname like 'bibliophile_%'"`.
     If a role shows `f`: `ALTER ROLE bibliophile_prod LOGIN;` (or staging).
2. The API reconnects by itself as soon as the database accepts it again. No
   restart is needed. Confirm with `/healthz`.
3. If passwords may have leaked: re-run `scripts/deploy/create-databases.sh`
   (new passwords for both logins) and paste the new internal URLs into both
   Render services.

## API down (no answer at all)

1. Render → service → **Events / Logs**. Did the last deploy fail, or is it
   crash-looping? The startup error is in the logs (bad config fails fast with
   `Invalid configuration: …` naming the variable).
2. If a recent deploy broke it: Actions → **rollback** → environment +
   the previous commit (from the last `promote` summary). Or Render → service
   → **Rollback** on the previous deploy.
3. Free instance hours used up (750 per month for the whole workspace): Render
   → Billing shows it. Wait for the new month or move production to Starter.

## Rollback

- **API:** Actions → `rollback` → environment, full commit SHA. It waits
  until `/healthz` reports that commit.
- **Website:** Netlify → project → **Deploys** → pick the earlier deploy (its
  message is its commit) → **Publish deploy**.
- **Database migrations:** each one has a down migration
  (`npm run migrate:down` with that environment's `DATABASE_URL`). Use it only
  if a migration itself is the problem: going down can drop data.

## Releasing

Push to `main` → `deploy` updates staging (tests, image, health gate, smoke
checks). Check staging. Then Actions → `promote` → the commit SHA. It only
accepts what staging is running.

## Routine

- **Monthly:** delete old image versions (keep 10). Check Netlify credits, Render
  free hours and Grafana usage.
- **Before the free database's day 30:** upgrade it or export it
  (`pg_dump "$EXTERNAL_URL" > backup.sql`).
- **After grading:** rotate every secret in [secrets.md](secrets.md).

## Escalation

Owner: the repository owner (GitHub). Provider status pages:
status.render.com, netlifystatus.com, status.grafana.com,
status.cloud.google.com, azure.status.microsoft (Entra).
