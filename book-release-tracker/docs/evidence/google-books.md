# F10 — third-party integration (Google Books)

**Claim:** the server calls Google Books with the key from the secret store, a
timeout, bounded retries, a cache that keeps us under Google's quota, a
runtime-validated response, and graceful degradation when Google is down.

| F10 item | Where | Test that proves it (`api/test/googleBooks.test.ts`) |
| --- | --- | --- |
| Key in secret store | `GOOGLE_BOOKS_API_KEY` from env (`api/.env` locally, host secret store in production; required in production by `config.ts`). Never logged; not in error messages | "the API key never appears in an error message" |
| Timeout | `AbortController`, 3 s default (`client.ts`) | "timeout: a hung connection is aborted…" |
| Bounded retry | 1 try + at most 2 retries, exponential backoff with jitter; only for timeout / network / 429 / 5xx; `Retry-After` honoured, capped at 2 s | "503, 503, then 200…", "always 503: gives up after…", "400/403 is NOT retried", "429 honours Retry-After" |
| Cache that respects limits | Postgres `google_books_cache`; searches 6 h, volumes 24 h. Default quota ≈ 1,000 requests/day/project. Duplicate imports are rejected before calling Google | "second identical search… Google called once", "after the TTL expires…", "import the same volume twice…" |
| Runtime-validated response | zod schemas (`schema.ts`); bad shape or non-JSON is treated as an outage | "runtime validation: …" (2 tests) |
| Graceful degradation | Expired cache served as `source: "stale"`; otherwise 503 `upstream_unavailable` in the standard error shape; circuit breaker stops calling a dead Google for 30 s | "Google DOWN + expired cache…", "Google DOWN + nothing cached…", "search with Google DOWN… -> 503", "circuit breaker…" |
| Rate limiting (S1) | 30 searches / 20 imports per minute per user, 429 + `Retry-After` | "search is rate limited: the 31st request…" |

## 1. Test with the provider stubbed down (the proof the spec asks for)

Fill in [hand-predictions-google.md](hand-predictions-google.md) first. Then:

```bash
cd api && npx vitest run test/googleBooks.test.ts --reporter=verbose
```

Paste the output (commit `_______`, date `_______`):

```
```

## 2. Live check with the real Google (optional, uses a little quota)

With the API running and both tokens set (see `scripts/curl-evidence.sh`), the
curl script now ends with a Google Books section: search (live), the same
search again (cache), Reader 403, too-short 400, import 201, duplicate import
409, bad id 400. Check that the second search says `"source":"cache"`.

## 3. Deliberate failure: Google goes down (Q3, and a good Game Day)

1. Search once with Google up, so something is cached:
   `curl -s -H "Authorization: Bearer $CURATOR_TOKEN" "localhost:3000/api/books/search?q=dune&maxResults=3"`
2. Stop the API. In `api/.env` uncomment `GOOGLE_BOOKS_BASE_URL=http://127.0.0.1:9`
   (nothing listens there, so every call fails). Start the API again.
3. Make the cached answer expire:
   `psql postgres://app:app@localhost:5433/booktracker -c "UPDATE google_books_cache SET expires_at = now() - interval '1 second';"`
4. Repeat the search from step 1 → **200 with `"source":"stale"`** and the
   old `fetchedAt`.
5. Search for something never searched (`q=neverbefore`) → **503
   `upstream_unavailable`**. The API terminal shows `google books failure`
   with the reason.
6. Comment `GOOGLE_BOOKS_BASE_URL` out again and restart.

Paste steps 4 and 5 (commit `_______`, date `_______`):

```
```

## 4. Interpretation

_(In your own words: what each item proves, and what a user sees while Google is down.)_
