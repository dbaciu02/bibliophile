import pg from "pg";
import type { Db } from "../db.js";
import { NOTIFY_CHANNEL } from "./emit.js";

/**
 * Fans catalog events out to every open SSE connection on this server (F11).
 *
 * One dedicated Postgres connection runs LISTEN. A NOTIFY only says "something
 * new"; the hub then reads every event with an id above the last one it
 * broadcast. Reading by id (not trusting the notification payload) means:
 *   - events always go out in id order;
 *   - if notifications are lost (the LISTEN connection dropped and
 *     reconnected), the next read still catches up on everything.
 * Because it goes through Postgres, this works with several server instances.
 *
 * The hub hands every event to every subscriber; each subscriber remembers the
 * last id it sent and drops anything at or below it, so replay-on-reconnect
 * and live delivery can overlap without duplicates.
 */

export interface StoredEvent {
  id: number;
  type: string;
  payload: unknown;
}

export interface Subscriber {
  /** Called for every event; the subscriber drops ids it has already sent. */
  send: (event: StoredEvent) => void;
  lastSentId: number;
}

export interface EventHub {
  /** Start receiving live events. Call `unsubscribe()` when the connection closes. */
  subscribe(sub: Subscriber): () => void;
  /** Events with id > afterId, oldest first (for replay). */
  eventsAfter(afterId: number, limit: number): Promise<StoredEvent[]>;
  /** Smallest id still stored (null if none), to detect a gap that can't be replayed. */
  oldestId(): Promise<number | null>;
  latestId(): Promise<number>;
  close(): Promise<void>;
}

interface Row {
  id: string;
  type: string;
  payload: unknown;
}
const toEvent = (r: Row): StoredEvent => ({ id: Number(r.id), type: r.type, payload: r.payload });

export async function createEventHub(
  db: Db,
  databaseUrl: string,
  opts: { log?: (msg: string, extra?: object) => void } = {},
): Promise<EventHub> {
  const log = opts.log ?? ((msg, extra) => console.log(JSON.stringify({ level: "info", msg, ...extra })));
  const subscribers = new Set<Subscriber>();
  let listener: pg.Client | null = null;
  let closed = false;
  let reconnectDelay = 500;

  const latestId = async () => {
    const { rows } = await db.query<{ max: string | null }>(`SELECT max(id) AS max FROM events`);
    return Number(rows[0]?.max ?? 0);
  };
  let lastBroadcastId = await latestId();

  // The events table's internal id (OID) changes when the table is dropped and
  // recreated (running the migrations down and up locally). Then ids restart
  // at 1, so the hub must start counting from the beginning again. Comparing
  // OIDs is exact; comparing max ids isn't (new events may already be above
  // the old max by the time we look).
  const tableOid = async () => {
    const { rows } = await db.query<{ oid: number }>(`SELECT 'events'::regclass::oid::int AS oid`);
    return rows[0]?.oid ?? 0;
  };
  let knownTableOid = await tableOid();

  // Serialize reads so two notifications close together can't broadcast out of order.
  let reading: Promise<void> = Promise.resolve();
  const catchUp = () => {
    reading = reading.then(async () => {
      try {
        const oid = await tableOid();
        if (oid !== knownTableOid) {
          knownTableOid = oid;
          lastBroadcastId = 0; // table was recreated: ids restarted
        } else if ((await latestId()) < lastBroadcastId) {
          lastBroadcastId = 0; // emptied with its sequence reset
        }
        const { rows } = await db.query<Row>(
          `SELECT id, type, payload FROM events WHERE id > $1 ORDER BY id LIMIT 500`,
          [lastBroadcastId],
        );
        for (const r of rows) {
          const event = toEvent(r);
          lastBroadcastId = event.id;
          // Every subscriber gets every event; each one drops what it has
          // already sent (see Subscriber.send in routes/events.ts).
          for (const sub of subscribers) sub.send(event);
        }
        if (rows.length === 500) catchUp(); // more waiting
      } catch (err) {
        log("event catch-up failed", { err: String(err) });
      }
    });
    return reading;
  };

  async function connectListener(): Promise<void> {
    const client = new pg.Client({ connectionString: databaseUrl });
    client.on("notification", () => void catchUp());
    client.on("error", (err) => {
      log("event listener lost its connection; reconnecting", { err: String(err) });
      void client.end().catch(() => {});
      if (listener === client) listener = null;
      scheduleReconnect();
    });
    await client.connect();
    await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
    listener = client;
    reconnectDelay = 500;
    await catchUp(); // anything committed while we weren't listening
  }

  function scheduleReconnect(): void {
    if (closed) return;
    const delay = reconnectDelay;
    reconnectDelay = Math.min(reconnectDelay * 2, 15_000);
    setTimeout(() => {
      connectListener().catch((err) => {
        log("event listener reconnect failed", { err: String(err), retryInMs: reconnectDelay });
        scheduleReconnect();
      });
    }, delay).unref();
  }

  await connectListener();

  // Retention: events are only needed to replay to clients that briefly
  // disconnected. Keep 7 days; older clients get `event: reset` instead.
  const prune = () =>
    db.query(`DELETE FROM events WHERE created_at < now() - interval '7 days'`).catch((err: unknown) =>
      log("event pruning failed", { err: String(err) }),
    );
  void prune();
  const pruneTimer = setInterval(() => void prune(), 60 * 60 * 1000);
  pruneTimer.unref();

  return {
    subscribe(sub) {
      subscribers.add(sub);
      return () => subscribers.delete(sub);
    },
    async eventsAfter(afterId, limit) {
      const { rows } = await db.query<Row>(
        `SELECT id, type, payload FROM events WHERE id > $1 ORDER BY id LIMIT $2`,
        [afterId, limit],
      );
      return rows.map(toEvent);
    },
    async oldestId() {
      const { rows } = await db.query<{ min: string | null }>(`SELECT min(id) AS min FROM events`);
      return rows[0]?.min === null || rows[0]?.min === undefined ? null : Number(rows[0].min);
    },
    latestId,
    async close() {
      closed = true;
      clearInterval(pruneTimer);
      subscribers.clear();
      await listener?.end().catch(() => {});
      listener = null;
    },
  };
}
