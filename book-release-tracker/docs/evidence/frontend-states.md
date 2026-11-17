# F1 / F2 — frontend pages and their loading, empty and error states

**Claims:**
- **F1:** a public React + TypeScript page with search and filters, which
  builds under `strict` with no `any` or `@ts-ignore`.
- **F2:** every remote call shows a visible loading, empty and error state.

## How it's built

Every read goes through `web/src/useRemote.ts` and is rendered by
`web/src/components/Remote.tsx`, so all of them share the same four states:
loading (spinner + text), empty (a message), error (message, request id,
**Try again**), ready. Writes (follow, remove, import) go through
`web/src/api/request.ts`, which never throws, and show their errors next to
the button that failed. All responses are checked with zod
(`web/src/api/schemas.ts`), so a malformed response becomes an error state,
never a half-drawn page.

| Remote call | Page | Loading | Empty | Error |
| --- | --- | --- | --- | --- |
| `GET /api/releases` | Releases | "Loading releases…" | "No upcoming releases…" / "No releases match these filters" + Clear | alert + Try again |
| `GET /api/me/watchlist` | My watchlist | "Loading your watchlist…" | "You aren't following any authors yet" | alert + Try again |
| `POST` / `DELETE /api/me/watchlist` | My watchlist | button "Adding…" / "Removing…" | — | message under the form / next to the row |
| `GET /api/books/search` | Curate | "Searching Google Books…" | "Google Books found nothing…" | alert + Try again; stale banner when Google is down but cached |
| `POST /api/releases/import` | Curate | button "Importing…" | — | message next to that book |
| `GET /api/me` | header | "Checking sign-in…" | — | "Couldn't load your account" + retry |
| `GET /healthz` | footer | "Checking the API…" | — | "API unreachable" + retry |

## 1. F1: strict build

```bash
npm run typecheck
grep -rnw --include='*.ts' --include='*.tsx' -e any -e ts-ignore -e ts-expect-error web/src
```

The first should print no errors. Read through what the second finds: matches
inside comments and words like "anyone" are fine, but there should be no `any`
type and no `@ts-ignore`. Paste both (commit `_______`):

```
> typecheck
> npm run typecheck --workspaces


> typecheck
> tsc --noEmit


> typecheck
> tsc --noEmit

web/src/test/helpers.tsx:10: * so tests can force any server answer — including failures — without a
web/src/pages/WatchlistPage.tsx:9:/** The signed-in user's followed authors (any role). */
web/src/pages/WatchlistPage.tsx:42:        empty={<p>You aren’t following any authors yet. Add one above.</p>}
web/src/pages/WatchlistPage.test.tsx:29:    expect(await screen.findByText(/aren’t following any authors yet/)).toBeInTheDocument();
web/src/pages/WatchlistPage.test.tsx:61:    expect(await screen.findByText(/aren’t following any authors yet/)).toBeInTheDocument();
web/src/pages/CuratePage.tsx:119:        Fill in any of the fields; they’re combined. Year and “Upcoming only” filter the results Google sends back.
```

## 2. F2: forced-failure tests

`web/src/pages/*.test.tsx` replace `fetch` with a fake that returns whatever
the test wants: slow, empty, network down, a 500, a malformed body, a 503, a 429.
Tests named **FORCED FAILURE** are the F2 proof.

```bash
cd web && npx vitest run --reporter=verbose
```

Paste the output (commit ``, date `11-16-2026`):

```
 RUN  v5.1.0 /Users/dorabaciu/Desktop/DePaul/Classes/CSC 436 Web Applications/bibliophile/book-release-tracker/web

 ✓ src/format.test.ts > formatReleaseDate shows a date only as precisely as it is known > 2026-11-04 (day) -> 4 Nov 2026 4ms
 ✓ src/format.test.ts > formatReleaseDate shows a date only as precisely as it is known > 2026-11-01 (month) -> Nov 2026 0ms
 ✓ src/format.test.ts > formatReleaseDate shows a date only as precisely as it is known > 2027-01-01 (year) -> 2027 0ms
 ✓ src/format.test.ts > formatReleaseDate shows a date only as precisely as it is known > 2028-02-29 (day) -> 29 Feb 2028 1ms
 ✓ src/format.test.ts > groupLabel > groups day and month releases by month, year-only releases separately 1ms
 ✓ src/pages/CuratePage.test.tsx > CuratePage > a Reader is told the page is for curators (the API would 403 anyway) 70ms
 ✓ src/pages/WatchlistPage.test.tsx > WatchlistPage > signed out: explains and offers sign-in, makes no API call 195ms
 ✓ src/pages/WatchlistPage.test.tsx > WatchlistPage > sends the access token and shows the list 67ms
 ✓ src/pages/ReleasesPage.test.tsx > ReleasesPage — loading, ready, empty, error (F2) > shows a loading state, then the releases grouped by month with honest dates 261ms
 ✓ src/pages/ReleasesPage.test.tsx > ReleasesPage — loading, ready, empty, error (F2) > empty: a clear message, not a blank page 22ms
 ✓ src/pages/WatchlistPage.test.tsx > WatchlistPage > empty list: a helpful message 15ms
 ✓ src/pages/CuratePage.test.tsx > CuratePage > search -> results -> import: button turns into 'In the catalog' 259ms
 ✓ src/pages/CuratePage.test.tsx > CuratePage > Google down but cached: shows the results with a 'may be out of date' banner (F10 degraded mode) 34ms
 ✓ src/pages/CuratePage.test.tsx > CuratePage > FORCED FAILURE: Google down and nothing cached -> the API's 503 message 26ms
 ✓ src/pages/ReleasesPage.test.tsx > ReleasesPage — loading, ready, empty, error (F2) > FORCED FAILURE (network down): shows an error with Try again, and Try again recovers 76ms
 ✓ src/pages/ReleasesPage.test.tsx > ReleasesPage — loading, ready, empty, error (F2) > FORCED FAILURE (server 500): shows the API's message and the request id for support 20ms
 ✓ src/pages/ReleasesPage.test.tsx > ReleasesPage — loading, ready, empty, error (F2) > FORCED FAILURE (unexpected response shape): treated as an error, not rendered half-broken 23ms
 ✓ src/pages/ReleasesPage.test.tsx > ReleasesPage — search and filters (F1) > asks the API for upcoming releases (from = today) when no filter is set 18ms
 ✓ src/pages/WatchlistPage.test.tsx > WatchlistPage > adding an author already followed shows the API's 409 message 114ms
 ✓ src/pages/WatchlistPage.test.tsx > WatchlistPage > removing an author calls DELETE and reloads the list 49ms
 ✓ src/pages/WatchlistPage.test.tsx > WatchlistPage > FORCED FAILURE: list request fails -> error state with Try again 35ms
 ✓ src/pages/CuratePage.test.tsx > CuratePage > FORCED FAILURE: import rejected (e.g. 429) -> message next to that book, page keeps working 93ms
 ✓ src/pages/ReleasesPage.test.tsx > ReleasesPage — search and filters (F1) > submitting the form puts the filters in the URL and the request 159ms
 ✓ src/pages/ReleasesPage.test.tsx > ReleasesPage — search and filters (F1) > filters in the URL are used on first load (shareable links) 17ms
 ✓ src/pages/ReleasesPage.test.tsx > ReleasesPage — search and filters (F1) > Later → requests the next page 48ms
 ✓ src/pages/ReleasesPage.test.tsx > ReleasesPage — Include past releases > ticking it re-requests WITHOUT the from=today default, keeps other filters, and changes the heading 37ms
 ✓ src/pages/ReleasesPage.test.tsx > ReleasesPage — Include past releases > an explicit From date still applies when past releases are included 13ms
 ✓ src/pages/ReleasesPage.test.tsx > ReleasesPage — Include past releases > the default empty message tells you past releases are hidden 11ms
 ✓ src/pages/CuratePage.test.tsx > CuratePage — search form fields > the filled-in fields go into the URL and the API request; empty ones are left out 228ms
 ✓ src/pages/CuratePage.test.tsx > CuratePage — search form fields > a year alone isn't a search: explains why and calls nothing 55ms
 ✓ src/pages/CuratePage.test.tsx > CuratePage — search form fields > a shared link fills the form back in 15ms
 ✓ src/pages/CuratePage.test.tsx > CuratePage — search form fields > says how many results the date filter hid 17ms
 ✓ src/pages/CuratePage.test.tsx > CuratePage — search form fields > everything hidden by the date filter: the empty message says so 15ms
 ✓ src/pages/CuratePage.test.tsx > CuratePage — search form fields > Clear empties the form and the URL 31ms

 Test Files  4 passed (4)
      Tests  34 passed (34)
   Start at  22:20:14
   Duration  3.45s (environment 63%, tests 18%, setup 11%, import 5%, transform 2%, worker 1%)
```

## 3. Screenshots

Run `npm run dev:api` and `npm run dev:web`, with a few releases in the
catalog (import some on the Curate page). Take each screenshot with the page
in the state described:

| # | State | How to cause it |
| --- | --- | --- |
| 1 | Releases, ready | Open `http://localhost:5173/` |
| 2 | Releases, filtered | Fill in Author, then Search (note the URL changes) |
| 3 | Releases, empty | Title = `zzzz` → Search |
| 4 | Releases, loading | DevTools → Network → throttling **Slow 3G**, reload |
| 5 | Releases, error | Stop the API (Ctrl+C in its terminal), reload. Then start it again and click **Try again**, and screenshot it recovering |
| 6 | Watchlist with a 409 | Follow an author, then follow the same author again |
| 7 | Curate, stale | Do the outage demo from [google-books.md](google-books.md) §2, then search the cached query on the Curate page |

Saved them as `docs/evidence/screenshots/f2-1-releases.png` and so on.
## 4. Interpretation
For states 1 through 5, which cover the Releases page, the screenshots illustrate how the frontend responds to different conditions:
- State 1 shows the default ready state with releases displayed.
- State 2 demonstrates the filtered view when a search is applied. In this case, author was Maas and the results are filtered accordingly.
- State 3 captures the empty state when no releases match the search criteria.
- State 4 depicts the loading state with network throttling.
- State 5 shows the error state when the API is temporarily unavailable and how it recovers after retrying. The API recovers and the user's username requires a reload to reflect the updated state.

For states 6 and 7, which cover the Watchlist and Curate pages, the screenshots illustrate how the frontend handles specific scenarios:
- State 6 illustrates the watchlist state when a duplicate author in the watchlist results in a 409 error.
- State 7 captures the Curate page showing stale data after a Google Books outage with the message `Google Books isn't responding, so these are saved results from 11/16/2026, 10:37:20 PM. They may be out of date.`, demonstrating how the frontend indicates the stale cache state when the API is redirected to the demonstration URL.
