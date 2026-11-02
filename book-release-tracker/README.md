# Book Release Tracker

Final project for Web Applications (DePaul, fall 2026). A public calendar of
upcoming book releases, a curator-managed catalog fed by the Google Books API,
and a personal author watchlist — built to meet the course's final web
application requirements.

**Status: step 1 of 9 — skeleton.** See [Build plan](#build-plan).

## Layout

```
api/          Express + TypeScript REST API
  migrations/   versioned SQL migrations (node-pg-migrate)
  src/          app code
  test/         Vitest tests (run against a real Postgres)
web/          React + TypeScript frontend (Vite)
docs/         Entra ID setup, evidence, AI use log
docker/       local database init
```

## Run it on a clean machine

Requires Node 22+ and either Docker or a local PostgreSQL 16.

```bash
git clone <repo-url> && cd book-release-tracker
npm install

# 1. Database (skip if you run Postgres yourself; create the same two DBs)
docker compose up -d db

# 2. Configuration
cp .env.example api/.env

# 3. Schema
npm run migrate:up

# 4. Run (two terminals)
npm run dev:api      # http://localhost:3000/healthz
npm run dev:web      # http://localhost:5173
```

## Checks

| Command | What it proves |
| --- | --- |
| `npm test` | All automated tests, one command (Q1). Uses the `booktracker_test` database. |
| `npm run typecheck` | `tsc --strict` for api and web, no errors (F1) |
| `npm run migrate:down` then `npm run migrate:up` | Initial migration is reversible (F5) |

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
2. API core: releases + watchlist routes, validation, audit log writes
3. Entra ID login (Auth Code + PKCE, `state`, `nonce`), token validation, roles — setup in [docs/entra-id-setup.md](docs/entra-id-setup.md)
4. Google Books integration: timeout, retry, cache, runtime validation, degraded mode
5. Frontend pages with loading / empty / error states
6. SSE live updates with replay
7. MCP server and MCP App
8. Deployment: staging + production, CI/CD, DNS, HTTPS, CDN, CORS, headers, rate limits
9. Observability, performance, accessibility, cost, runbook, Game Day

## Honest limits

Things not done yet are listed in the build plan above and will be kept
current here. AI assistance is logged in [docs/ai-use-log.md](docs/ai-use-log.md).
