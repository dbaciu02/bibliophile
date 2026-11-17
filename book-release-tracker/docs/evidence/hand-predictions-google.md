# Q1 hand predictions — Google Books integration (third-party test)

**Fill this in by hand BEFORE running `npx vitest run test/googleBooks.test.ts`.**
Don't look at the test file's expected values first.

The rules (`api/src/googleBooks/client.ts`, `cachedBooks.ts`):
- Each call has a timeout. Failures that can be temporary (timeout, network
  error, 429, 5xx) are retried **at most 2 times** after the first attempt.
- 400, 403 and 404 are **not** retried.
- On a 429, wait what Google's `Retry-After` header says, but **never more than 2 seconds**.
- A search result is cached for 6 hours. If Google is down and only an
  *expired* cached answer exists, that answer is returned with
  `source: "stale"`.
- `/api/books/search` allows 30 requests per minute per user.

| Situation | Question | My prediction | Test result (referring to results in `google-books.md`) | Agreed? |
| --- | --- | --- | --- | --- |
| Google answers 503, 503, then 200 | How many calls does our server make? |2  |3  |No  |
| Google always answers 503 | How many calls before it gives up? |2  |3  |No  |
| Google answers 400 | How many calls? | 0 |1  |No  |
| Google answers 429 with `Retry-After: 60` | How many milliseconds do we wait before retrying? |60,000 ms  |2000ms  |No  |
| Search "Dune", then "  dune " a minute later | How many calls to Google in total? What `source` does the second one have? |  Calls twice and source is the second cache: dune|Calls once - the source is cache  |No  |
| Search once (Google up), cache expires, search again (Google down) | What `source`? How many calls to Google in total? |source: stale - calls once|Source is stale and calls 4 times  |No  |
| Google down, never searched before | What HTTP status does `/api/books/search` return? |404  |503  |No  |
| Curator sends 31 searches within one minute | Status of the 31st? |429  |429  |Yes  |

Date predicted: 11/16/2026

I disagreed with several predictions because the server's behavior differed from my expectations, particularly in how it handles retries and caching.
- For the Google 503 then 200 case, I predicted 2 calls, but the test shows 3. The test is correct because the server retries twice after the first failure, making a total of 3 calls.
- For the Google always 503 case, I predicted 2 calls, but the test shows 3. Again, the server retries twice after the first failure.
- For the Google 400 case, I predicted 0 calls, but the test shows 1. The server makes the initial call and does not retry on 400.
- For the 429 with `Retry-After: 60`, I predicted 60,000 ms, but the test shows 2000 ms. The server caps the wait at 2 seconds. (I calculated 60,000 ms from the `Retry-After` header, but the server enforces a 2-second maximum.)
- For the "Dune" then "  dune " case, I predicted 2 calls, but the test shows 1. The server normalizes the query and uses the cache for the second request.
- For the cache expires then Google down case, I predicted 1 call, but the test shows 4. The server retries twice on failure, making 3 calls after the initial one.
- For Google down, never searched before, I predicted 404, but the test shows 503. The server returns 503 when the upstream is unavailable and nothing is cached.
