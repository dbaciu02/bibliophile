import type { DbClient } from "../db.js";

/**
 * Live-update events (F11).
 *
 * Every catalog change writes one row to `events` and sends a Postgres NOTIFY,
 * both on the SAME transaction as the change itself. Postgres only delivers a
 * NOTIFY when the transaction commits, so:
 *   - a change that is rolled back (e.g. a 409) produces no event;
 *   - an event never arrives before its data is visible to other connections.
 *
 * The row's id (bigserial) is the SSE event id. Ids only grow, so "everything
 * after id N" is exactly what a client that last saw N has missed.
 *
 * Only PUBLIC catalog changes are events. Watchlist changes are personal and
 * are never broadcast.
 *
 * ORDERING: ids come from a sequence when the row is inserted, but two
 * transactions can COMMIT in the opposite order (id 10 visible before id 9).
 * A reader that already saw 10 would then never deliver 9 — a lost event.
 * So each writer takes a transaction-scoped advisory lock before getting its
 * id and holds it until commit/rollback: ids become visible strictly in order.
 * Catalog writes are rare (curators only), so the short wait doesn't matter.
 * Found by the "no duplicates during replay" test in test/events.test.ts.
 */

const EVENT_ORDER_LOCK = 4_826_301; // any constant; only used for this lock

export const NOTIFY_CHANNEL = "book_events";

export type LiveEvent =
  | { type: "release.created"; payload: { id: number; title: string; releaseDate: string } }
  | { type: "release.updated"; payload: { id: number; title: string; releaseDate: string } }
  | { type: "release.hidden"; payload: { id: number } };

export async function emitEvent(client: DbClient, event: LiveEvent): Promise<number> {
  await client.query(`SELECT pg_advisory_xact_lock($1)`, [EVENT_ORDER_LOCK]);
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO events (type, payload) VALUES ($1, $2) RETURNING id`,
    [event.type, JSON.stringify(event.payload)],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("event insert returned no id");
  // Only the id goes in the notification; listeners read the row itself.
  await client.query(`SELECT pg_notify($1, $2)`, [NOTIFY_CHANNEL, id]);
  return Number(id);
}
