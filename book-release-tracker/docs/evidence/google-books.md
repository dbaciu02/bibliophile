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
| Field search and date filters | `googleBooks/query.ts` builds `intitle:` / `inauthor:` / `subject:` / `inpublisher:` / `isbn:`; year and upcoming filtering done by our API (Google has no date filter) | "builds Google's field syntax…", "year filter keeps only that year…", "the date filters don't change what's cached…" |
| Rate limiting (S1) | 30 searches / 20 imports per minute per user, 429 + `Retry-After` | "search is rate limited: the 31st request…" |

## 1. Test with the provider stubbed down (the proof the spec asks for)

Fill in [hand-predictions-google.md](hand-predictions-google.md) first. Then:

```bash
cd api && npx vitest run test/googleBooks.test.ts --reporter=verbose
```

Paste the output (commit `dbbb50edc1b9bdb3e74d932d79d573b6ee185c5a`, date `11-16-2026`):

```
(base) dorabaciu@Doras-MacBook-Pro book-release-tracker % npm test

> test
> npm run test --workspace api


> test
> vitest run


 RUN  v5.0.5 /Users/dorabaciu/Desktop/DePaul/Classes/CSC 436 Web Applications/bibliophile/book-release-tracker/api

stderr | test/googleBooks.test.ts > GET /api/books/search and POST /api/releases/import > search with Google DOWN and nothing cached -> 503 in the standard error shape
{"level":"warn","msg":"google books failure","kind":"unavailable","attempts":3,"detail":"Google Books unavailable: Google Books returned 503"}

stderr | test/googleBooks.test.ts > GET /api/books/search and POST /api/releases/import > import with Google DOWN and nothing cached -> 503, and nothing is written
{"level":"warn","msg":"google books failure","kind":"unavailable","attempts":3,"detail":"Google Books unavailable: Google Books returned 503"}

 ✓ test/googleBooks.test.ts (33 tests) 4845ms
   ✓ cache in front of Google (F10: respects the quota, degrades gracefully) (5)
     ✓ second identical search within the TTL is served from cache — Google called once 749ms
   ✓ GET /api/books/search and POST /api/releases/import (11)
     ✓ search is rate limited: the 31st request in a minute -> 429 with Retry-After (S1) 366ms
 ✓ test/releases.test.ts (28 tests) 2680ms
 ✓ test/auth.test.ts (23 tests) 837ms
 ✓ test/watchlist.test.ts (10 tests) 705ms
 ✓ test/migrations.test.ts (11 tests) 1020ms
 ✓ test/http.test.ts (7 tests) 96ms
 ✓ test/releaseDate.test.ts (25 tests) 10ms

 Test Files  7 passed (7)
      Tests  137 passed (137)
   Start at  16:37:37
   Duration  13.55s (tests 83%, import 14%, transform 2%, setup 1%)

    Isolate  7 workers spawned · ~158ms startup each (spawn + environment, per file)
             at least ~945ms faster with isolate: false — reuses workers across files instead of one per file

(base) dorabaciu@Doras-MacBook-Pro book-release-tracker % cd api && npx vitest run test/googleBooks.test.ts --reporter=verbose

 RUN  v5.0.5 /Users/dorabaciu/Desktop/DePaul/Classes/CSC 436 Web Applications/bibliophile/book-release-tracker/api

 ✓ test/googleBooks.test.ts > Google Books client — timeout, bounded retry, validation (F10) > success on the first try: exactly 1 call, key sent as the documented ?key= parameter 19ms
 ✓ test/googleBooks.test.ts > Google Books client — timeout, bounded retry, validation (F10) > 503, 503, then 200: retries twice and succeeds — 3 calls 1ms
 ✓ test/googleBooks.test.ts > Google Books client — timeout, bounded retry, validation (F10) > always 503: gives up after 1 try + 2 retries — 3 calls, never more (bounded) 1ms
 ✓ test/googleBooks.test.ts > Google Books client — timeout, bounded retry, validation (F10) > timeout: a hung connection is aborted after timeoutMs, and the timeouts are retried too 91ms
 ✓ test/googleBooks.test.ts > Google Books client — timeout, bounded retry, validation (F10) > network error is retried like a 5xx 1ms
 ✓ test/googleBooks.test.ts > Google Books client — timeout, bounded retry, validation (F10) > 429 honours Retry-After (capped), then retries 2ms
 ✓ test/googleBooks.test.ts > Google Books client — timeout, bounded retry, validation (F10) > 400 is NOT retried (retrying a bad request can't help) — 1 call 0ms
 ✓ test/googleBooks.test.ts > Google Books client — timeout, bounded retry, validation (F10) > 403 is NOT retried (retrying a bad request can't help) — 1 call 0ms
 ✓ test/googleBooks.test.ts > Google Books client — timeout, bounded retry, validation (F10) > 404 on a volume -> not_found, 1 call 1ms
 ✓ test/googleBooks.test.ts > Google Books client — timeout, bounded retry, validation (F10) > runtime validation: a 200 with the wrong shape is rejected, not passed on 1ms
 ✓ test/googleBooks.test.ts > Google Books client — timeout, bounded retry, validation (F10) > runtime validation: a 200 that isn't JSON is rejected 1ms
 ✓ test/googleBooks.test.ts > Google Books client — timeout, bounded retry, validation (F10) > no results: Google omits `items`; that's valid 0ms
 ✓ test/googleBooks.test.ts > Google Books client — timeout, bounded retry, validation (F10) > circuit breaker: after 3 failed calls it stops calling Google for the cooldown,then tries again 1ms
 ✓ test/googleBooks.test.ts > Google Books client — timeout, bounded retry, validation (F10) > the API key never appears in an error message 0ms
 ✓ test/googleBooks.test.ts > mapping Google data to our model > normalizes the date with the core calculation and upgrades the thumbnail to https 1ms
 ✓ test/googleBooks.test.ts > mapping Google data to our model > an unusable date becomes null instead of a guess 0ms
 ✓ test/googleBooks.test.ts > mapping Google data to our model > thumbnails from other hosts are dropped 0ms
 ✓ test/googleBooks.test.ts > cache in front of Google (F10: respects the quota, degrades gracefully) > second identical search within the TTL is served from cache — Google called once 207ms
 ✓ test/googleBooks.test.ts > cache in front of Google (F10: respects the quota, degrades gracefully) > after the TTL expires, Google is asked again 166ms
 ✓ test/googleBooks.test.ts > cache in front of Google (F10: respects the quota, degrades gracefully) > Google DOWN + expired cache -> the old answer is served, marked stale (graceful degradation) 161ms
 ✓ test/googleBooks.test.ts > cache in front of Google (F10: respects the quota, degrades gracefully) > Google DOWN + nothing cached -> the error is passed up (becomes a 503)144ms
 ✓ test/googleBooks.test.ts > cache in front of Google (F10: respects the quota, degrades gracefully) > a 404 is NOT papered over with stale data 175ms
 ✓ test/googleBooks.test.ts > GET /api/books/search and POST /api/releases/import > search: 200 with normalized candidates, source and inCatalog 164ms
 ✓ test/googleBooks.test.ts > GET /api/books/search and POST /api/releases/import > search: Reader -> 403, anonymous -> 401 (only curators spend quota) 149ms
 ✓ test/googleBooks.test.ts > GET /api/books/search and POST /api/releases/import > search: 400 for a too-short query, without calling Google 151ms
stderr | test/googleBooks.test.ts > GET /api/books/search and POST /api/releases/import > search with Google DOWN and nothing cached -> 503 in the standard error shape
{"level":"warn","msg":"google books failure","kind":"unavailable","attempts":3,"detail":"Google Books unavailable: Google Books returned 503"}

 ✓ test/googleBooks.test.ts > GET /api/books/search and POST /api/releases/import > search with Google DOWN and nothing cached -> 503 in the standard error shape 146ms
 ✓ test/googleBooks.test.ts > GET /api/books/search and POST /api/releases/import > search is rate limited: the 31st request in a minute -> 429 with Retry-After (S1) 316ms
 ✓ test/googleBooks.test.ts > GET /api/books/search and POST /api/releases/import > import: 201 + Location, release built from Google data, audited as release.import 179ms
 ✓ test/googleBooks.test.ts > GET /api/books/search and POST /api/releases/import > import the same volume twice -> 409, and the second time Google isn't even called 184ms
 ✓ test/googleBooks.test.ts > GET /api/books/search and POST /api/releases/import > import a volume with no usable date -> 400 explaining why 199ms
 ✓ test/googleBooks.test.ts > GET /api/books/search and POST /api/releases/import > import a volume Google doesn't have -> 404 265ms
stderr | test/googleBooks.test.ts > GET /api/books/search and POST /api/releases/import > import with Google DOWN and nothing cached -> 503, and nothing is written
{"level":"warn","msg":"google books failure","kind":"unavailable","attempts":3,"detail":"Google Books unavailable: Google Books returned 503"}

 ✓ test/googleBooks.test.ts > GET /api/books/search and POST /api/releases/import > import with Google DOWN and nothing cached -> 503, and nothing is written 150ms
 ✓ test/googleBooks.test.ts > GET /api/books/search and POST /api/releases/import > import as Reader -> 403 137ms

 Test Files  1 passed (1)
      Tests  33 passed (33)
   Start at  16:38:12
   Duration  4.14s (tests 89%, import 9%, transform 1%)
```


## 2. Deliberate failure: Google goes down (Q3, and a good Game Day)

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

Paste steps 4 and 5 (commit `dbbb50edc1b9bdb3e74d932d79d573b6ee185c5a`, date `11-26-2026`):

```
(base) dorabaciu@Doras-MacBook-Pro api % curl -s -H "Authorization: Bearer $CURATOR_TOKEN" "localhost:3000/api/books/search?q=dune&maxResults=3"
{"items":[{"googleVolumeId":"ryot4Ag2GGQC","title":"Chapterhouse: Dune","authors":["Frank Herbert"],"publishedDateRaw":"1987","releaseDate":"1987-01-01","datePrecision":"year","categories":["Fiction"],"thumbnailUrl":"https://books.google.com/books/content?id=ryot4Ag2GGQC&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api","inCatalog":false},{"googleVolumeId":"BpgkiOdga5IC","title":"The Winds of Dune","authors":["Kevin J. Anderson","Brian Herbert"],"publishedDateRaw":"2009-10-01","releaseDate":"2009-10-01","datePrecision":"day","categories":["Fiction"],"thumbnailUrl":"https://books.google.com/books/content?id=BpgkiOdga5IC&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api","inCatalog":false},{"googleVolumeId":"hOy3EAAAQBAJ","title":"Dune (Movie Tie-In)","authors":["Frank Herbert"],"publishedDateRaw":"2023-09-26","releaseDate":"2023-09-26","datePrecision":"day","categories":["Fiction"],"thumbnailUrl":"https://books.google.com/books/content?id=hOy3EAAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api","inCatalog":false}],"totalItems":507,"source":"stale","fetchedAt":"2026-11-16T23:31:05.666Z"}%                                                                                          

(base) dorabaciu@Doras-MacBook-Pro api % curl -s -H "Authorization: Bearer $CURATOR_TOKEN" "localhost:3000/api/books/search?q=neverbefore&maxResults=3"
{"error":{"code":"upstream_unavailable","message":"Google Books is unavailable right now and nothing is cached for this request. Try again later.","requestId":"ebe69214-25fd-4776-85d5-843a02f0d9cc"}}% 
```

## 3. Interpretation
For the first search (`q=dune`), even though Google is down, the API returns the cached result with `"source":"stale"`. This shows that the caching mechanism works and provides users with data using the cache even when the upstream service is unavailable. When I changed the `GOOGLE_BOOKS_BASE_URL` to the deliberate failure URL, the API could not reach Google and relied on the cache. For the second search (`q=neverbefore`), since there is no cached result and Google is down, the API returns a `503` with `upstream_unavailable`. This demonstrates that the API correctly handles the case where neither the cache nor the upstream service can provide the requested data as expected. After changing the `GOOGLE_BOOKS_BASE_URL` back to its normal value and restarting, the API can fetch fresh data from Google again. 
