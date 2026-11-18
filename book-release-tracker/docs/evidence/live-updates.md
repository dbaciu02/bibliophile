# F11 — live updates (Server-Sent Events)

**Claim:** catalog changes reach open pages within about a second, over SSE,
and a page that loses its connection reconnects without losing or
duplicating events.

## Why SSE and not WebSockets

- **The data flows one way.** The server tells browsers "a release was
  added/changed/removed"; browsers never send anything back on this channel.
  SSE is built for exactly that; WebSockets are two-way.
- **It's plain HTTP.** It goes through the CDN, proxies and the same CORS and
  security headers as every other request (step 8), with no protocol upgrade.
- **Reconnect and resume are built in.** The browser's `EventSource`
  reconnects automatically and sends `Last-Event-ID`. With WebSockets, all of
  that would have to be written by hand.
- **The feed is public**, like the catalog, so it needs no token. `EventSource`
  can't send an `Authorization` header, which would have mattered for a
  private feed. Personal watchlist changes are never sent on this stream.

## How "no lost, no duplicated events" works

| Piece | Where | What it guarantees |
| --- | --- | --- |
| Event row + `pg_notify` in the same transaction as the change | `api/src/events/emit.ts` | Rolled-back writes (e.g. a 409) produce no event; an event is never sent before its data is visible |
| Advisory lock before taking an event id | `emit.ts` | Ids become visible strictly in order, so a reader that saw #10 can never later find #9 (the bug described below) |
| Event id = `events.id` (always increasing) | migration 1 | "Everything after N" is exactly what a client that last saw N missed |
| Subscribe first (before choosing the start point or answering), queue, replay, then flush the queue | `api/src/routes/events.ts` | Nothing that happens while connecting or during the replay is missed |
| Per-connection `lastSentId` | `events.ts` | An event in both the replay and the live queue goes out once |
| Hub reads by id after each NOTIFY, and catches up after its listener reconnects | `api/src/events/hub.ts` | Lost notifications don't lose events; works with several server instances |
| `reset` event when the gap can't be replayed (pruned after 7 days, or an unknown id) | `events.ts` | The page reloads its list instead of silently missing changes |
| `ping` every 15 s + a 35 s browser watchdog | `events.ts`, `web/src/live/useLiveEvents.ts` | A stream a proxy holds open after the server died is detected and reopened with `?lastEventId=` |
| Ignore ids at or below the last one handled | `useLiveEvents.ts` | A second guard in the browser |

### A concurrency bug a test caught (good for Q3)

The first version had no advisory lock. The test "NO DUPLICATES even when
writes happen DURING the replay" failed about 1 run in 6. The cause: ids are
taken when a write *starts*, but two writes can *commit* in the opposite order.
The hub broadcast #10, then never sent #9. A stress test (30 simultaneous
writes) lost events in 2 of 6 runs without the lock, and 0 of 6 with it.
Try it yourself: comment out the `pg_advisory_xact_lock` line in `emit.ts`,
run `npx vitest run test/events.test.ts -t "NO LOST EVENTS"` a few times, then
put it back.

A second race, found when the stress test failed only inside the full test
run: a brand-new connection looked up "the latest event id" *before*
subscribing to live events. An event committed between those two steps was
too new to be history and too early to be live, so it was never sent. Fix:
subscribe first, then pick the start point, then answer the browser
(`routes/events.ts`). The test "NO GAP for a brand-new client when the server
is slow to look up where to start" makes that window 600 ms wide on purpose:
it fails 3/3 with the old order and passes 3/3 with the new one.

A third issue: Vite's dev proxy kept the browser's stream open after the API
was killed, so the page stayed "Live" forever. That led to the `ping` and
watchdog, and a fix in `web/vite.config.ts`.

(Also, the hub now notices when the `events` table is recreated, e.g. when
you run the migrations down and up locally, by its internal OID, and starts
counting from 1 again.)

## 1. Automated tests

```bash
cd api && npx vitest run test/events.test.ts --reporter=verbose
cd ../web && npx vitest run src/pages/ReleasesPage.live.test.tsx --reporter=verbose
```

The API tests use a real server and real streaming connections. Paste both
outputs (commit `_______`, date `11-17-2026`):

```

 RUN  v5.1.0 /Users/dorabaciu/Desktop/DePaul/Classes/CSC 436 Web Applications/bibliophile/book-release-tracker/api

 ✓ test/events.test.ts > events are written in the same transaction as the change > create, update and hide each write exactly one event 424ms
 ✓ test/events.test.ts > events are written in the same transaction as the change > a rejected write (409) writes no event 413ms
 ✓ test/events.test.ts > events are written in the same transaction as the change > personal watchlist changes are never broadcast 282ms
 ✓ test/events.test.ts > GET /api/events (SSE) > is a public, uncacheable event stream 212ms
 ✓ test/events.test.ts > GET /api/events (SSE) > a new client gets live events as they happen, not old history 994ms
 ✓ test/events.test.ts > GET /api/events (SSE) > KILL AND RECOVER: events written while disconnected are replayed on reconnect, exactly once, in order 1211ms
 ✓ test/events.test.ts > GET /api/events (SSE) > ?lastEventId= works the same for a page that reloads 535ms
 ✓ test/events.test.ts > GET /api/events (SSE) > NO DUPLICATES even when writes happen DURING the replay 1161ms
 ✓ test/events.test.ts > GET /api/events (SSE) > NO LOST EVENTS when many curators save at the same moment (commit order != id order) 1198ms
 ✓ test/events.test.ts > GET /api/events (SSE) > NO GAP for a brand-new client when the server is slow to look up where to start 2085ms
 ✓ test/events.test.ts > GET /api/events (SSE) > several clients each get every event 658ms
 ✓ test/events.test.ts > GET /api/events (SSE) > sends a named `ping` event (no id) as a heartbeat, so the page can spot a dead stream 454ms
 ✓ test/events.test.ts > GET /api/events (SSE) > a Last-Event-ID the server never issued (database was reset) -> reset event 342ms
 ✓ test/events.test.ts > GET /api/events (SSE) > events older than the replay window (pruned) -> reset event instead of a silent gap 322ms
 ✓ test/events.test.ts > GET /api/events (SSE) > the server's database listener is killed: it reconnects and clients still get the event 1096ms

 Test Files  1 passed (1)
      Tests  15 passed (15)
   Start at  14:35:00
   Duration  13.11s (tests 96%, import 3%, transform 1%)


 RUN  v5.1.0 /Users/dorabaciu/Desktop/DePaul/Classes/CSC 436 Web Applications/bibliophile/book-release-tracker/web

 ✓ src/pages/ReleasesPage.live.test.tsx > ReleasesPage — live updates > connects to /api/events and shows Live, then Reconnecting when the connection drops 112ms
 ✓ src/pages/ReleasesPage.live.test.tsx > ReleasesPage — live updates > a new release appears without a reload, tagged New, and without a loading flash 626ms
 ✓ src/pages/ReleasesPage.live.test.tsx > ReleasesPage — live updates > a hidden release disappears 286ms
 ✓ src/pages/ReleasesPage.live.test.tsx > ReleasesPage — live updates > a burst of events causes one re-fetch, and a repeated event id is ignored 535ms
 ✓ src/pages/ReleasesPage.live.test.tsx > ReleasesPage — live updates > a reset event (server couldn't replay) reloads the list 272ms
 ✓ src/pages/ReleasesPage.live.test.tsx > ReleasesPage — live updates > the first connection triggers one re-fetch, covering changes made while the page was loading 269ms
 ✓ src/pages/ReleasesPage.live.test.tsx > ReleasesPage — silent dead stream (watchdog) > no event or ping for 35 s: closes the stream and reconnects with the last event id 26ms

 Test Files  1 passed (1)
      Tests  7 passed (7)
   Start at  14:35:14
   Duration  4.08s (tests 55%, environment 35%, setup 7%, import 2%, transform 1%)
```

## 2. Kill-and-recover demo (the proof the spec asks for)

You need two API instances on the same database (like a real deployment with
two servers), the web app, and a Curator token in the terminal you'll use for
`curl` (see `scripts/curl-evidence.sh` for how to copy one).

| Terminal | Command |
| --- | --- |
| A | `npm run dev:api` (port 3000; the browser talks to this one) |
| B | `PORT=3001 npm run dev:api` (a second instance) |
| C | `npm run dev:web` |
| D | `export CURATOR_TOKEN=$(pbpaste)` (for the `curl`s below) |

A helper for terminal D:

```bash
add() { curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "Authorization: Bearer $CURATOR_TOKEN" -H "Content-Type: application/json" \
  -d "{\"googleVolumeId\":\"demo$RANDOM\",\"title\":\"$1\",\"publishedDate\":\"2027-03\",\"authors\":[\"Demo Author\"]}" \
  localhost:3001/api/releases; }
```

1. Open `http://localhost:5173/?q=Demo`. The pill says **● Live**. Open
   **Live update log**, and DevTools → Network.
2. `add "Demo Live 1"`. The book appears with a **New** tag, no reload.
   Note its `#id` in the log. *(screenshot)*
3. **Kill:** press Ctrl+C in terminal A. Within a few seconds the pill says
   **Reconnecting…** *(screenshot)*
4. While it's down: `add "Demo Missed 1"` and `add "Demo Missed 2"`.
   They go through instance B, so they are saved, but this page can't hear them.
5. **Recover:** start terminal A again (`npm run dev:api`). The pill goes back
   to **Live**, and both missed books appear. The log shows their ids once
   each, in order, right after the id from step 2. *(screenshot)*
6. In DevTools → Network, click the newest `events` request → Headers →
   Request Headers: **`Last-Event-ID`** is the id from step 2. That is the
   browser saying "the last one I saw was N". *(screenshot)*
7. `add "Demo Live 2"`. It's live again.

## 3. Interpretation

The first screenshot `f11-step-2.png` shows the new book "Demo Live 1" appearing in the log on the release page, confirming it was added successfully. The id associated with this book is noted in the log, which will be used to track subsequent events and ensure no updates are missed or duplicated. The second screenshot `f11-step-3.png` shows the pill indicating Reconnecting… after terminal A is killed, demonstrating the temporary loss of live updates. The third screenshot `f11-step-5.png` shows the missed books "Demo Missed 1" and "Demo Missed 2" appearing after recovery, with their ids correctly following the id from step 2 proving that no events were lost or duplicated. The fourth screenshot `f11-step-6.png` shows the `Last-Event-ID` header in the network request confirming that the browser correctly communicates the last seen event to the servers. SSE was the right choice for this scenario because it allows the browser to maintain a persistent connection to the server, receiving real-time updates without the need for continuous polling. This ensures that live updates are delivered efficiently and reliably, even in the presence of temporary network interruptions or server restarts.