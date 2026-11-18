import { Router } from "express";
import type { EventHub, StoredEvent, Subscriber } from "../events/hub.js";

/**
 * GET /api/events — Server-Sent Events stream of catalog changes (F11). Public,
 * like the catalog itself; nothing personal is ever sent here.
 *
 * Why SSE and not WebSockets: updates only flow server -> browser; SSE is plain
 * HTTP, so it passes through the CDN and proxies like any request; and the
 * browser's EventSource reconnects by itself and sends `Last-Event-ID`, which
 * is exactly what "no lost events" needs. WebSockets would mean writing all of
 * that by hand for a one-way feed.
 *
 * Reconnect without loss or duplicates:
 *   1. The client sends the id of the last event it got (`Last-Event-ID`
 *      header, sent automatically by EventSource on reconnect, or
 *      `?lastEventId=` on a first connection).
 *   2. We subscribe to live events FIRST (before even answering), holding them
 *      in a queue, then replay every stored event with a larger id, then flush
 *      the queue. Nothing that happens during the replay can be missed.
 *   3. The subscriber's `lastSentId` filter drops anything already sent, so an
 *      event that is both in the replay and in the live queue goes out once.
 *   4. If the client is so far behind that its events were pruned (or more than
 *      REPLAY_LIMIT behind), or sends an id we never issued (the database was
 *      reset), we send `event: reset` and the page reloads its list.
 */

const REPLAY_LIMIT = 1000;
// A real (named) event, not an SSE comment, because browsers hide comments
// from JavaScript: the page uses these pings to notice a stream that a proxy
// is holding open after the server died. It has no `id:` so it doesn't move
// the client's Last-Event-ID. 15 s is also under typical proxy idle timeouts.
const HEARTBEAT_MS = 15_000;

function parseLastId(header: string | undefined, query: unknown): number | null {
  const raw = header ?? (typeof query === "string" ? query : undefined);
  if (raw === undefined || raw === "") return null;
  return /^\d{1,15}$/.test(raw) ? Number(raw) : null;
}

function frame(e: StoredEvent): string {
  return `id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e.payload)}\n\n`;
}

export function eventsRouter(hub: EventHub, opts: { heartbeatMs?: number } = {}): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const requested = parseLastId(req.get("last-event-id"), req.query.lastEventId);

    // Subscribe BEFORE deciding where this client starts and before telling it
    // it's connected. Any event committed from here on is either <= start
    // (dropped: the client doesn't need it) or > start (queued, then sent).
    // Doing these in the other order left a window where an event was neither.
    const queue: StoredEvent[] = [];
    let replaying = true;
    const sub: Subscriber = {
      lastSentId: 0, // set to `start` below; until then everything is queued
      send(e) {
        if (replaying) {
          queue.push(e);
          return;
        }
        if (e.id <= sub.lastSentId) return; // already sent: no duplicates
        res.write(frame(e));
        sub.lastSentId = e.id;
      },
    };
    const unsubscribe = hub.subscribe(sub);
    let start: number;
    try {
      start = requested ?? (await hub.latestId()); // new client: only future events
    } catch (err) {
      unsubscribe();
      throw err;
    }
    sub.lastSentId = start;

    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-store: a CDN must never cache or buffer this stream (D6).
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // tell nginx-style proxies not to buffer
    });
    res.flushHeaders();
    res.write(`retry: 3000\n\n`); // browser waits 3 s before reconnecting

    const heartbeat = setInterval(() => res.write(`event: ping\ndata: {}\n\n`), opts.heartbeatMs ?? HEARTBEAT_MS);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });

    try {
      if (requested !== null) {
        const [oldest, latestNow] = await Promise.all([hub.oldestId(), hub.latestId()]);
        const missed = await hub.eventsAfter(requested, REPLAY_LIMIT + 1);
        const pruned = oldest !== null && requested < oldest - 1;
        // An id from the future means the client saw a different (e.g. reset) database.
        const unknown = requested > latestNow;
        if (pruned || unknown || missed.length > REPLAY_LIMIT) {
          // Can't replay exactly: tell the page to reload, and continue from now.
          const latest = await hub.latestId();
          res.write(`id: ${latest}\nevent: reset\ndata: {}\n\n`);
          sub.lastSentId = latest;
        } else {
          for (const e of missed) {
            res.write(frame(e));
            sub.lastSentId = e.id;
          }
        }
      } else {
        res.write(`: connected, waiting for new events\n\n`);
      }
    } finally {
      replaying = false;
      for (const e of queue.splice(0)) sub.send(e);
    }
  });

  return router;
}
