# Requirements checklist

Every requirement from the course's final-project checklist, how this project
meets it, which build step does it, and where the proof lives. Update the
**Evidence** column yourself as you collect it: only tick it when the file
exists and contains output *you* produced.

**Code:** ✅ done · 🔶 partly done · ⬜ not started
**Evidence:** ☐ to collect · ☑ collected (commit SHA recorded in the file)

Build steps are listed in [README.md → Build plan](../README.md#build-plan).

---

## 1. Hard gates (any one caps the grade)

| Gate | How this project meets it | Step | Code | Evidence |
| --- | --- | --- | --- | --- |
| No live secret anywhere (repo, image, logs, screenshots, client bundle) | `.env` git-ignored; [secrets.md](secrets.md) lists secrets by name only; config errors print names, never values; no Entra client secret exists; `VITE_*` holds only public ids; [scripts/redact-har.mjs](../scripts/redact-har.mjs) refuses to write a HAR with a token in it | all | 🔶 | ☐ redaction attestation (Q3) |
| No fabricated or altered evidence | All evidence files are run and pasted by you; hand predictions written before tests; AI-produced examples are labelled as such | all | — | ☐ |
| Deployment reproducible from instructions | README "Run it on a clean machine" (verified from a clean copy each step); IaC/config | 8 | 🔶 | ☐ clean-clone run |
| No write action or MCP tool reachable without authorization | Every write route uses `requireAuth` (`api/src/auth.ts`); tests prove 401/403; MCP tools get per-tool scopes | 2, 7 | 🔶 | ☐ |
| Synthetic data only | Own Entra tenant with made-up test users (not DePaul's); `npm run seed` adds 160 invented books (24 hand-written + 136 generated with a fixed seed, `api/src/seed/sampleBooks.ts`), audited as `system:seed-script`. **Open question:** confirm with the instructor that public Google Books catalog data is acceptable | 3, 4 | 🔶 | ☐ instructor's answer |

## 2. Functional requirements

| # | Requirement | How this project meets it | Step | Code | Evidence (proof the spec asks for) |
| --- | --- | --- | --- | --- | --- |
| F1 | React + TS frontend, public page, search and filter, clean `tsc --strict` | `web/` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; no `any` / `@ts-ignore`. Public page `/` with title, author, category and date filters kept in the URL | 1, 5 | ✅ | ☐ `npm run typecheck` output, see [frontend-states.md](evidence/frontend-states.md) |
| F2 | Loading, empty and error states for every remote call | Reads: `useRemote` + `components/Remote.tsx`; writes: `api/request.ts` with inline errors; every response zod-checked | 5 | ✅ | ☐ screenshots + forced-failure tests (`web/src/pages/*.test.tsx`), see [frontend-states.md](evidence/frontend-states.md) |
| F3 | REST API: correct methods, status codes, one JSON error shape, server-side validation | Routes in README; one error shape (`api/src/errors.ts`); strict zod validation (`api/src/validation.ts`) | 2 | ✅ | ☐ `scripts/curl-evidence.sh` → `docs/evidence/curl-<sha>.txt` (run with tokens) |
| F4 | Real database, survives restarts; PKs, FKs, a justified index | Postgres; schema in `api/migrations/`; `books(published_date)` index justified in [index-explain.md](evidence/index-explain.md) | 1 | ✅ | ☐ ER diagram (step 9) · ☐ restart test · ☐ your EXPLAIN output |
| F5 | Versioned migrations, at least one reversible and tested | Two `node-pg-migrate` SQL migrations with Up/Down; `api/test/migrations.test.ts` runs all up, the newest down and up alone, then all down | 1 | ✅ | ☐ `npm run migrate:down` + `migrate:up` log |
| F6 | Append-only audit trail; actor from validated token | `audit_log` + trigger blocking UPDATE/DELETE/TRUNCATE; written in the same transaction as each change (`api/src/audit.ts`) | 1, 2 | ✅ | ☐ [audit-query.md](evidence/audit-query.md) output |
| F7 | OAuth 2.0 / OIDC with a real provider; Auth Code + PKCE, `state`, `nonce`; no home-made passwords | Entra ID via `oidc-client-ts`; nonce passed explicitly (`web/src/auth/`) | 3 | ✅ | ☐ redacted HAR, see [login-flow.md](evidence/login-flow.md) |
| F8 | Server-side token validation: signature, issuer, audience, expiry, scope | `jose` with Entra's JWKS, RS256 only (`api/src/auth.ts`) | 2 | ✅ | ☐ `npx vitest run test/auth.test.ts` output (one failing case per check) |
| F9 | At least two roles from validated claims, enforced on the server | Reader / Curator app roles in the token's `roles` claim | 2, 3 | ✅ | ☐ 401 anonymous + 403 Reader lines from the curl transcript |
| F10 | Third-party API from the server: key in secret store, timeout, bounded retry, cache within limits, runtime-validated response, graceful degradation | Google Books, server-side only (`api/src/googleBooks/`): 3 s timeout, ≤2 retries, Postgres cache, zod validation, stale fallback + circuit breaker | 4 | ✅ | ☐ stubbed-down test output + outage demo, see [google-books.md](evidence/google-books.md) |
| F11 | Live updates (SSE or WebSockets), justified; reconnect without loss or duplicates | SSE (`GET /api/events`): events written in the same transaction as each change, ordered by an advisory lock, replayed from `Last-Event-ID`, de-duplicated per connection; ping + watchdog for dead streams | 6 | ✅ | ☐ tests + kill-and-recover demo, see [live-updates.md](evidence/live-updates.md) |
| F12 | MCP server: ≥3 read tools, 1 write tool with confirmation, OAuth with per-tool scopes, audited | `POST /mcp` (`api/src/mcp/`): read tools `search_releases`, `get_release`, `upcoming_for_author`, `get_my_watchlist`, `show_release_calendar`; write tool `add_to_watchlist` with a server-issued one-time confirmation token. Entra tokens, RFC 9728 metadata, per-tool scopes (403 `insufficient_scope` step-up), roles, every call audited. See [mcp.md](mcp.md) | 7 | ✅ | ☐ `test/mcp.test.ts` output · ☐ `scripts/mcp-evidence.sh` transcript (read-only token → 403) · ☐ audit query, see [evidence/mcp.md](evidence/mcp.md) |
| F13 | Interactive MCP App (React/TS), same authorization | `mcp-app/`: release calendar served as `ui://bibliophile/release-calendar.html`; range change and Follow (with Confirm) are tool calls through the host, so the same scopes, roles, confirmation and audit apply; axe 0 violations | 7 | ✅ | ☐ app tests output · ☐ host recording/screenshots, see [evidence/mcp.md](evidence/mcp.md) |

## 3. Deployment and delivery

| # | Requirement | Plan | Step | Code | Evidence |
| --- | --- | --- | --- | --- | --- |
| D1 | Public on own domain / course subdomain; DNS records with TTL rationale | _host and domain to choose in step 8_ | 8 | ⬜ | ☐ `dig +trace`, zone export |
| D2 | HTTPS only, auto-renewal, CAA, HTTP→HTTPS redirect, expiry monitoring that has fired | | 8 | ⬜ | ☐ cert chain, alert evidence |
| D3 | Separate staging and production (data and secrets); changes go through staging | Separate DBs, secrets and Entra registrations per environment ([entra-id-setup.md §7](entra-id-setup.md)) | 8 | ⬜ | ☐ two URLs, a change stopped at staging |
| D4 | CI/CD builds, tests, deploys; gated on `/healthz`; rollback; records SHA and image digest | `/healthz` already returns 503 when the DB is down and reports `GIT_SHA` | 1, 8 | 🔶 | ☐ pipeline logs, rollback |
| D5 | Reproducible build: IaC or exported config; README works on a clean machine | README verified from a clean copy at every step so far | 8 | 🔶 | ☐ clean-clone run |
| D6 | CDN with a cache policy per content class; no personalized response shared-cached | `/api/me*` and `/healthz` already send `private, no-store` / `no-store` | 8 | 🔶 | ☐ headers showing MISS, HIT, 304, invalidation |
| D7 | CORS allowlist of exact origins; CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy` | | 8 | ⬜ | ☐ allowed vs refused preflight |
| D8 | Core Web Vitals measured; one improvement with before/after | | 9 | ⬜ | ☐ Lighthouse / RUM data |
| D9 | No serious/critical axe violations; keyboard-only operation | Labels on every input, skip link, visible focus, `aria-live` states, `aria-current` nav. axe on Releases / Watchlist / Curate during step 5: 0 violations after fixing one serious label mismatch | 5, 9 | 🔶 | ☐ axe report, keyboard walkthrough |
| D10 | OpenTelemetry logs, metrics, one trace across ≥2 components; SLI, SLO, an alert that fired | Structured JSON logs with request ids so far | 9 | 🔶 | ☐ dashboard, trace id |
| D11 | Free tier or budget alert; monthly cost at 1×, 10×, 100× with arithmetic | | 9 | ⬜ | ☐ budget screenshot, cost table |

## 4. Security, data and operations

| # | Requirement | Plan | Step | Code | Evidence |
| --- | --- | --- | --- | --- | --- |
| S1 | Rate limiting on login, write and third-party-backed endpoints | Google-backed routes limited per user (`api/src/rateLimit.ts`); login is Entra's; write routes and the shared/CDN layer in step 8 | 4, 8 | 🔶 | ☐ 429 evidence (test "31st request" now; live in step 8) |
| S2 | Runbook a stranger can follow; Game Day postmortem of a deliberate failure | | 9 | ⬜ | ☐ `docs/runbook.md`, `docs/game-day.md` |

## 5. Engineering quality

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| Q1 | Tests for validation, authorization, third-party (stubbed), a core calculation; hand-predicted; one command | Validation ✅ (`releases.test.ts`, `watchlist.test.ts`) · Authorization ✅ (`auth.test.ts`) · Third-party ✅ (`googleBooks.test.ts`, Google stubbed) · Core calculation ✅ (`releaseDate.test.ts`) · One command ✅ (`npm test`) | ☐ [hand-predictions.md](evidence/hand-predictions.md) and [hand-predictions-google.md](evidence/hand-predictions-google.md) (yours) · ☐ full `npm test` output |
| Q2 | Diagrams: request path (browser → DNS → CDN → app → DB/third party) and trust boundaries | ⬜ step 9 (could be drafted earlier) | ☐ |
| Q3 | Per claim: commit SHA, reproduction commands, raw evidence, your interpretation, one deliberate failure, AI-use log, one challenged AI claim, redaction attestation | 🔶 ongoing. Evidence files already have SHA / reproduce / interpretation sections. Challenged-claim candidate: oidc-client-ts sends no `nonce` by default (see [login-flow.md](evidence/login-flow.md)) | ☐ [ai-use-log.md](ai-use-log.md) kept current · ☐ redaction attestation |
| Q4 | You can explain and change any part | No oral defense this term (instructor's decision); shown through the written report, your interpretations and the AI-use log | — |

## 6. Deliverables

| Deliverable | Where | Status |
| --- | --- | --- |
| Production URLs (HTTPS) | README, after step 8 | ⬜ |
| Repo with README, IaC/config, CI/CD, tests | this repo | 🔶 |
| Architecture and trust-boundary diagrams | `docs/diagrams/` (step 9) | ⬜ |
| Load, scaling and cost analysis | `docs/cost.md` (step 9) | ⬜ |
| Runbook and Game Day postmortem | `docs/runbook.md`, `docs/game-day.md` (step 9) | ⬜ |
| AI provenance log | [ai-use-log.md](ai-use-log.md) | 🔶 ongoing |
| Live demo | — | ⬜ |
| ~~Individual oral defense~~ | Not required this term | — |
| Secrets hand-off (separate file, not in the repo) | [secrets.md → Hand-off](secrets.md) | ⬜ end of project |

## Open questions for the instructor

1. Is public Google Books catalog data acceptable under "synthetic data only"? (All users and watchlists are synthetic test accounts.)
2. For the secrets hand-off: an actual `.env` file, or is access to staging plus the README enough?
3. Has the charter for the book-release domain been approved? _(Record the date.)_
