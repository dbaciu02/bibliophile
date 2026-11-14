# Q1 hand predictions — Google Books integration (third-party test)

**Fill this in by hand BEFORE running `npx vitest run test/googleBooks.test.ts`.**
Don't look at the test file's expected values first.

The rules (`api/src/googleBooks/client.ts`, `cachedBooks.ts`):
- Each call has a timeout. Failures that can be temporary (timeout, network
  error, 429, 5xx) are retried **at most 2 times** after the first attempt.
- 400, 403 and 404 are **not** retried.
- On a 429, wait what Google's `Retry-After` header says, but **never more
  than 2 seconds**.
- A search result is cached for 6 hours. If Google is down and only an
  *expired* cached answer exists, that answer is returned with
  `source: "stale"`.
- `/api/books/search` allows 30 requests per minute per user.

| Situation | Question | My prediction | Test result | Agreed? |
| --- | --- | --- | --- | --- |
| Google answers 503, 503, then 200 | How many calls does our server make? |  |  |  |
| Google always answers 503 | How many calls before it gives up? |  |  |  |
| Google answers 400 | How many calls? |  |  |  |
| Google answers 429 with `Retry-After: 60` | How many milliseconds do we wait before retrying? |  |  |  |
| Search "Dune", then "  dune " a minute later | How many calls to Google in total? What `source` does the second one have? |  |  |  |
| Search once (Google up), cache expires, search again (Google down) | What `source`? How many calls to Google in total? |  |  |  |
| Google down, never searched before | What HTTP status does `/api/books/search` return? |  |  |  |
| Curator sends 31 searches within one minute | Status of the 31st? |  |  |  |

Date predicted: ________ Commit SHA tested: ________

Where you disagreed, explain which was right and why. Don't change the test
to match your prediction, or your prediction to match the test.
