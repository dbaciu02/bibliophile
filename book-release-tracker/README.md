# Book Release Tracker

Final project for Web Applications (DePaul, fall 2026). A public calendar of
upcoming book releases, a curator-managed catalog fed by the Google Books API,
and a personal author watchlist — built to meet the course's final web
application requirements.

**Status: step 9 of 9 — operations (observability, performance, accessibility, cost, runbook, Game Day).** See [Build plan](#build-plan) and the

**Live:**

| | Production | Staging |
| --- | --- | --- |
| Website | https://bibliophile.dorabaciu.dev | https://staging.bibliophile.dorabaciu.dev |
| API (health + commit) | https://api.bibliophile.dorabaciu.dev/healthz | https://api.staging.bibliophile.dorabaciu.dev/healthz |
| MCP endpoint | https://api.bibliophile.dorabaciu.dev/mcp | https://api.staging.bibliophile.dorabaciu.dev/mcp |

Sign-in works only for accounts in the project's own Entra tenant (test users;
credentials are in the private hand-off, not here). Signed out, the release
list is public. The free API sleeps after 15 minutes idle: the first request
after that takes about a minute.
full [requirements checklist](docs/requirements-checklist.md).

## Layout

```
api/          Express + TypeScript REST API
  migrations/   versioned SQL migrations (node-pg-migrate)
  src/          app code
  test/         Vitest tests (run against a real Postgres)
web/          React + TypeScript frontend (Vite)
mcp-app/      MCP App: the release calendar shown inside AI assistants (React + TS)
  dev-host/     minimal MCP Apps host for local testing (never deployed)
scripts/      curl-evidence.sh (F3), mcp-evidence.sh (F12) transcripts
  deploy/       deploy helpers used by CI (Render deploy, health gate, smoke checks) and DB setup
  traffic.sh    steady test traffic (Game Day, dashboard); lh-summary.mjs: Lighthouse before/after table
              load-test.mjs: small read-only load test for the scaling section of cost.md
docs/         setup guides (Entra, deployment, observability), architecture, cost, runbook,
              Game Day, secrets inventory, evidence, AI use log
docker/       local database init
Dockerfile    the API image (API + migrations + MCP App), built and pushed by CI
.github/      workflows: deploy (CI + staging), promote (production), rollback, cert-check, purge-cache
```

## Run it on a clean machine

Requires Node 22+ and either Docker or a local PostgreSQL 16.

```bash
git clone <repo-url> bibliophile && cd bibliophile/book-release-tracker
npm install

# 1. Database on localhost:5433 (not 5432, so it doesn't clash with a
#    Postgres already installed on the machine). Skip if you run Postgres
#    yourself; create the same two DBs and adjust the URLs in api/.env.
docker compose up -d db

# If `npm test` says database "booktracker_test" does not exist:
docker compose exec db psql -U app -d booktracker -c "CREATE DATABASE booktracker_test OWNER app;"

# 2. Configuration (fill in the Entra IDs: see docs/entra-id-setup.md)
cp .env.example api/.env
#    and create web/.env with the three VITE_ENTRA_* lines from .env.example

# 3. Schema
npm run migrate:up

# 3b. Optional: 160 invented sample books (dates relative to today), so the
#     catalog isn't empty. Safe to run again; `npm run seed:remove` hides them.
npm run seed

# 3c. Build the MCP App the API serves (once, and after changing mcp-app/)
npm run build:mcp-app

# 4. Run (two terminals)
npm run dev:api      # http://localhost:3000/healthz (MCP at /mcp)
npm run dev:web      # http://localhost:5173

# Optional: try the MCP App in the local test host (docs/mcp.md)
npm run dev:mcp-host # http://localhost:5174
```

## Checks

| Command | What it proves |
| --- | --- |
| `npm test` | All automated tests (API, web, MCP App), one command (Q1). The API tests use the `booktracker_test` database. |
| `npm run typecheck` | `tsc --strict` for api, web and mcp-app, no errors (F1) |
| `npm run migrate:down` then `npm run migrate:up` | Initial migration is reversible (F5) |
| `scripts/curl-evidence.sh` | `curl -i` for every route incl. failures (F3); see the script header |
| `scripts/mcp-evidence.sh` | `curl -i` for the MCP endpoint: 401 + metadata, 403 for a read-only token, the confirmation step (F12) |

## API routes

| Method & path | Who | Statuses |
| --- | --- | --- |
| `GET /healthz` | public | 200, 503 |
| `GET /api/releases?from&to&q&category&author&limit&offset` | public | 200, 400 |
| `GET /api/releases/:id` | public | 200, 400, 404 |
| `POST /api/releases` | Curator (`Releases.Write`) | 201 + Location, 400, 401, 403, 409 |
| `PATCH /api/releases/:id` | Curator (`Releases.Write`) | 200, 400, 401, 403, 404 |
| `DELETE /api/releases/:id` (soft hide) | Curator (`Releases.Write`) | 204, 400, 401, 403, 404 |
| `GET /api/books/search?q&title&author&subject&publisher&isbn&orderBy&year&upcomingOnly&maxResults` (Google Books, cached) | Curator (`Releases.Write`) | 200, 400, 401, 403, 429, 503 |
| `POST /api/releases/import` `{googleVolumeId}` | Curator (`Releases.Write`) | 201 + Location, 400, 401, 403, 404, 409, 429, 503 |
| `GET /api/events` (Server-Sent Events: `release.created`, `release.updated`, `release.hidden`, `reset`, `ping`) | public | 200 stream |
| `GET /.well-known/oauth-protected-resource/mcp` (RFC 9728: where to get a token for `/mcp`) | public | 200 |
| `POST /mcp` (MCP, Streamable HTTP; tools in [docs/mcp.md](docs/mcp.md)) | bearer token; scope per tool | 200 · 401 · 403 `insufficient_scope` |
| `GET /api/me` | Reader or Curator (`Releases.Read`) | 200, 401, 403 |
| `GET /api/me/watchlist` | Reader or Curator (`Watchlist.ReadWrite`) | 200, 401, 403 |
| `POST /api/me/watchlist` | Reader or Curator (`Watchlist.ReadWrite`) | 201 + Location, 400, 401, 403, 409 |
| `DELETE /api/me/watchlist/:id` | Reader or Curator (`Watchlist.ReadWrite`) | 204, 400, 401, 403, 404 |

Notes:
- `q` (title) and `category` match part of the text, ignoring capitals;
  `author` matches when every word typed appears in one author's name
  (`Maas` and `sarah maas` both find "Sarah J. Maas").
- `from`/`to` match by **overlap**: a release dated only "2026-11" appears for
  `from=2026-11-20`, because it may still come out that month.
- Unknown query parameters or body fields are a 400, so typos don't silently
  return unfiltered results.
- Another user's watchlist item returns 404, not 403, so ids can't be probed.
- Every write saves an audit row in the same transaction (`api/src/audit.ts`).
- Google Books is only called from the server, through a Postgres cache
  (searches 6 h, volumes 24 h); when Google is down an expired answer is
  served with `"source":"stale"`, otherwise 503. Google can't filter by
  date, so `year` and `upcomingOnly` are applied by our API to the results
  Google returns (`hiddenByDateFilter` says how many were dropped). Details and evidence:
  [docs/evidence/google-books.md](docs/evidence/google-books.md).

## Authentication and roles

`api/src/auth.ts` accepts a request only if the bearer token passes, in order:
signature (RS256, key from the JWKS), issuer, audience, expiry → otherwise
**401**; then the route's scope and role → otherwise **403**.

The browser signs in with `oidc-client-ts` (Authorization Code + PKCE,
`state`, and a `nonce` the code passes explicitly, because the library doesn't
add one by default). Tokens are kept in `sessionStorage`. Evidence guide:
[docs/evidence/login-flow.md](docs/evidence/login-flow.md).

Until Entra ID is configured (`ENTRA_TENANT_ID`, `ENTRA_API_CLIENT_ID` in
`api/.env`), protected routes return 401 in development; production refuses to
start without them. Tests don't use Entra: `api/test/tokens.ts` signs tokens
with a local test key and the real verification code checks them.

## Pages

| Path | Who | What |
| --- | --- | --- |
| `/` | everyone | Upcoming releases grouped by month (tick "Include past releases" for books already out); search by title, author, category, date range. Filters live in the URL, so a search can be bookmarked. Curators also get **Edit** and **Hide** on each release |
| `/watchlist` | signed in | Follow authors; each shows how many upcoming releases they have |
| `/curate` | Curator | **Add a release by hand** (title, authors, date as `2027` / `2027-03` / `2027-03-15`, categories, optional cover link), or search Google Books by keywords, title, author, subject, publisher or ISBN; filter by year or upcoming only; sort by relevance or newest; import into the catalog |

The releases page updates itself live (● Live / Reconnecting… indicator, a
"New" tag, and a Live update log). How reconnects avoid lost or duplicated
events, and why SSE: [docs/evidence/live-updates.md](docs/evidence/live-updates.md).

Every remote call has loading, empty and error states
([docs/evidence/frontend-states.md](docs/evidence/frontend-states.md)).

## Error shape

Every error response from the API has this body (F3), and the same id is in
the `X-Request-Id` header and the server log:

```json
{ "error": { "code": "not_found", "message": "No route for GET /api/x", "requestId": "…", "details": [] } }
```

`details` appears only on validation errors. Codes: `validation_failed`,
`invalid_json` (400), `unauthenticated` (401), `forbidden` (403), `not_found`
(404), `conflict` (409), `rate_limited` (429), `internal` (500),
`upstream_unavailable` (503).

## Schema decisions

- **Release dates** are stored as the first day of the period plus a
  precision (`year`/`month`/`day`), because Google Books often gives only
  `"2026"` or `"2026-11"`. See `api/src/lib/releaseDate.ts`.
- **Justified index:** `books(published_date)`. The public calendar always
  filters by a date range; without the index each page load is a full scan.
  `EXPLAIN` evidence: [docs/evidence/index-explain.md](docs/evidence/index-explain.md).
- **Roles are not stored.** They come from the validated Entra ID token on
  every request, so changing a role in Entra takes effect without touching the
  database.
- **Audit log is append-only in the database**, enforced by a trigger that
  rejects `UPDATE`, `DELETE` and `TRUNCATE` (a `REVOKE` wouldn't stop the
  table owner, which is what the app connects as).
- **`events.id` is the SSE event id**, so reconnecting clients resume from
  `Last-Event-ID` without gaps or duplicates.

## Build plan

1. ✅ Skeleton: repo, strict TS, initial reversible migration, `/healthz`, error shape, test command
2. ✅ API core: releases + watchlist routes, validation, audit log writes, server-side token validation and roles
3. ✅ Entra ID login in the browser (Auth Code + PKCE, `state`, `nonce`), API wired to the real tenant — setup in [docs/entra-id-setup.md](docs/entra-id-setup.md)
4. ✅ Google Books integration: timeout, retry, cache, runtime validation, degraded mode, rate limits on Google-backed routes
5. ✅ Frontend pages (releases calendar with search/filters, watchlist, curator import) with loading / empty / error states
6. ✅ SSE live updates with replay (no lost or duplicated events across reconnects)
7. ✅ MCP server and MCP App: six tools behind Entra OAuth with per-tool scopes, a confirmed write tool, every call audited; the release calendar as an MCP App — see [docs/mcp.md](docs/mcp.md)
8. ✅ Deployment: Netlify (site + CDN) and Render (API, Postgres) behind your own domain, staging and production, GitHub Actions with a `/healthz` gate and rollback, CORS allowlist, security headers, write-route rate limits — see [docs/deployment.md](docs/deployment.md)
9. ✅ Operations: OpenTelemetry → Grafana Cloud (traces across API → Postgres → Google Books, SLOs, alert), cost model, runbook, Game Day plan, architecture diagrams — see [docs/observability.md](docs/observability.md), [docs/cost.md](docs/cost.md), [docs/runbook.md](docs/runbook.md), [docs/game-day.md](docs/game-day.md), [docs/architecture.md](docs/architecture.md). Evidence for D8–D11 and S2 is still to be collected on the live site.

## Honest limits

Things not done yet are listed in the build plan above and will be kept
current here.

- `npm audit` reports 3 moderate advisories (GHSA-3g3m-2fjr-6pw4,
  GHSA-g3hv-75wg-m249) in `glob`/`minimatch`, pulled in by `node-pg-migrate`.
  They only run when migrations run, on our own `migrations/` folder, never on
  user input. Rechecked for deployment (step 8): still the only findings in
  the production dependencies (`npm audit --omit=dev`). npm's only fix is
  downgrading node-pg-migrate two major versions, and an override to a newer
  glob didn't take, so this stays accepted. In the image, migrations run once
  at container start, against the image's own `migrations/` folder.
- `npm audit` also reports GHSA-fc5q-39xc-vjpf (high, ReDoS) in `picomatch`,
  used by the build and test tools (Vite, Vitest, vite-plugin-singlefile).
  They only match our own config's file patterns, never user input, and
  nothing from them ships to the server or browser (the API image installs
  production dependencies only). No fixed picomatch version exists yet.
- Deployment limits (free database expiry, one Postgres instance for both
  environments, sleeping free API services) are listed in
  [docs/deployment.md](docs/deployment.md#honest-limits).

AI assistance is logged in [docs/ai-use-log.md](docs/ai-use-log.md).
