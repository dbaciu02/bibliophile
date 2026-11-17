# Book Release Tracker

Final project for Web Applications (DePaul, fall 2026). A public calendar of
upcoming book releases, a curator-managed catalog fed by the Google Books API,
and a personal author watchlist — built to meet the course's final web
application requirements.

**Status: step 5 of 9 — frontend pages.** See [Build plan](#build-plan) and the
full [requirements checklist](docs/requirements-checklist.md).

## Layout

```
api/          Express + TypeScript REST API
  migrations/   versioned SQL migrations (node-pg-migrate)
  src/          app code
  test/         Vitest tests (run against a real Postgres)
web/          React + TypeScript frontend (Vite)
scripts/      curl-evidence.sh (F3 transcripts)
docs/         Entra ID setup, secrets inventory, evidence, AI use log
docker/       local database init
```

## Run it on a clean machine

Requires Node 22+ and either Docker or a local PostgreSQL 16.

```bash
git clone <repo-url> && cd book-release-tracker
npm install

# 1. Database on localhost:5433 (not 5432, so it doesn't clash with a
#    Postgres already installed on the machine). Skip if you run Postgres
#    yourself; create the same two DBs and adjust the URLs in api/.env.
docker compose up -d db

# 2. Configuration (fill in the Entra IDs: see docs/entra-id-setup.md)
cp .env.example api/.env
#    and create web/.env with the three VITE_ENTRA_* lines from .env.example

# 3. Schema
npm run migrate:up

# 4. Run (two terminals)
npm run dev:api      # http://localhost:3000/healthz
npm run dev:web      # http://localhost:5173
```

## Checks

| Command | What it proves |
| --- | --- |
| `npm test` | All automated tests, API and web, one command (Q1). The API tests use the `booktracker_test` database. |
| `npm run typecheck` | `tsc --strict` for api and web, no errors (F1) |
| `npm run migrate:down` then `npm run migrate:up` | Initial migration is reversible (F5) |
| `scripts/curl-evidence.sh` | `curl -i` for every route incl. failures (F3); see the script header |

## API routes

| Method & path | Who | Statuses |
| --- | --- | --- |
| `GET /healthz` | public | 200, 503 |
| `GET /api/releases?from&to&q&category&author&limit&offset` | public | 200, 400 |
| `GET /api/releases/:id` | public | 200, 400, 404 |
| `POST /api/releases` | Curator (`Releases.Write`) | 201 + Location, 400, 401, 403, 409 |
| `PATCH /api/releases/:id` | Curator (`Releases.Write`) | 200, 400, 401, 403, 404 |
| `DELETE /api/releases/:id` (soft hide) | Curator (`Releases.Write`) | 204, 400, 401, 403, 404 |
| `GET /api/books/search?q&maxResults` (Google Books, cached) | Curator (`Releases.Write`) | 200, 400, 401, 403, 429, 503 |
| `POST /api/releases/import` `{googleVolumeId}` | Curator (`Releases.Write`) | 201 + Location, 400, 401, 403, 404, 409, 429, 503 |
| `GET /api/me` | Reader or Curator (`Releases.Read`) | 200, 401, 403 |
| `GET /api/me/watchlist` | Reader or Curator (`Watchlist.ReadWrite`) | 200, 401, 403 |
| `POST /api/me/watchlist` | Reader or Curator (`Watchlist.ReadWrite`) | 201 + Location, 400, 401, 403, 409 |
| `DELETE /api/me/watchlist/:id` | Reader or Curator (`Watchlist.ReadWrite`) | 204, 400, 401, 403, 404 |

Notes:
- `from`/`to` match by **overlap**: a release dated only "2026-11" appears for
  `from=2026-11-20`, because it may still come out that month.
- Unknown query parameters or body fields are a 400, so typos don't silently
  return unfiltered results.
- Another user's watchlist item returns 404, not 403, so ids can't be probed.
- Every write saves an audit row in the same transaction (`api/src/audit.ts`).
- Google Books is only called from the server, through a Postgres cache
  (searches 6 h, volumes 24 h); when Google is down an expired answer is
  served with `"source":"stale"`, otherwise 503. Details and evidence:
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
| `/` | everyone | Upcoming releases grouped by month; search by title, author, category, date range. Filters live in the URL, so a search can be bookmarked |
| `/watchlist` | signed in | Follow authors; each shows how many upcoming releases they have |
| `/curate` | Curator | Search Google Books and import volumes into the catalog |

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
6. SSE live updates with replay
7. MCP server and MCP App
8. Deployment: staging + production, CI/CD, DNS, HTTPS, CDN, CORS, headers, rate limits
9. Observability, performance, accessibility, cost, runbook, Game Day

## Honest limits

Things not done yet are listed in the build plan above and will be kept
current here.

- `npm audit` reports 3 moderate advisories (GHSA-3g3m-2fjr-6pw4,
  GHSA-g3hv-75wg-m249) in `glob`/`minimatch`, pulled in by `node-pg-migrate`.
  They only run when migrations run, on our own `migrations/` folder, never on
  user input. npm's only fix is downgrading node-pg-migrate to 7.x, so this is
  accepted for now and rechecked before deployment. AI assistance is logged in [docs/ai-use-log.md](docs/ai-use-log.md).
