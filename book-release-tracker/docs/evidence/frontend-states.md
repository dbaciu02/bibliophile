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
grep -rn "any\b\|@ts-ignore\|@ts-expect-error" web/src --include=*.ts --include=*.tsx
```

The first should print no errors. Read through what the second finds: matches
inside comments and words like "anyone" are fine, but there should be no `any`
type and no `@ts-ignore`. Paste both (commit `_______`):

```
```

## 2. F2: forced-failure tests

`web/src/pages/*.test.tsx` replace `fetch` with a fake that returns whatever
the test wants: slow, empty, network down, a 500, a malformed body, a 503, a 429.
Tests named **FORCED FAILURE** are the F2 proof.

```bash
cd web && npx vitest run --reporter=verbose
```

Paste the output (commit `_______`, date `_______`):

```
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
| 7 | Curate, stale | Do the outage demo from [google-books.md](google-books.md) §3, then search the cached query on the Curate page |

Save them as `docs/evidence/screenshots/f2-1-releases.png` and so on.
Check that no screenshot shows a token, the DevTools Application tab or
your Google key.

## 4. Interpretation

_(In your own words.)_
