import type { Principal } from "../auth.js";
import { writeAudit } from "../audit.js";
import { isUniqueViolation, type Db, type DbClient } from "../db.js";
import { HttpError } from "../errors.js";

/**
 * Watchlist data access, shared by the REST routes (/api/me/watchlist) and the
 * MCP tools (get_my_watchlist, add_to_watchlist), so both behave identically.
 */

export interface WatchlistItem {
  id: number;
  author: string;
  upcomingCount: number; // visible releases by this author that are still upcoming today
  createdAt: string;
}

interface WatchlistRow {
  id: string;
  author: string;
  upcoming_count: number;
  created_at: Date;
}

const toItem = (r: WatchlistRow): WatchlistItem => ({
  id: Number(r.id),
  author: r.author,
  upcomingCount: r.upcoming_count,
  createdAt: r.created_at.toISOString(),
});

// "Upcoming" = the release's period hasn't ended yet (same rule as isUpcoming()).
const UPCOMING_COUNT_SQL = `
  (SELECT count(*)::int
     FROM book_authors ba JOIN books b ON b.id = ba.book_id
    WHERE ba.author_id = a.id AND NOT b.hidden
      AND CASE b.date_precision
            WHEN 'day'   THEN b.published_date
            WHEN 'month' THEN (date_trunc('month', b.published_date) + interval '1 month - 1 day')::date
            ELSE              (date_trunc('year',  b.published_date) + interval '1 year - 1 day')::date
          END >= current_date)`;

/** Finds or creates the users row for this token subject; returns its id. */
export async function upsertUser(client: Db | DbClient, p: Principal): Promise<number> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO users (idp_subject, display_name) VALUES ($1, $2)
     ON CONFLICT (idp_subject) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
    [p.subject, p.name],
  );
  return Number(rows[0]?.id);
}

export async function getItem(client: Db | DbClient, userId: number, itemId: number): Promise<WatchlistItem | null> {
  const { rows } = await client.query<WatchlistRow>(
    `SELECT w.id, a.name AS author, ${UPCOMING_COUNT_SQL} AS upcoming_count, w.created_at
       FROM watchlist_items w JOIN authors a ON a.id = w.author_id
      WHERE w.id = $1 AND w.user_id = $2`,
    [itemId, userId],
  );
  const row = rows[0];
  return row ? toItem(row) : null;
}

export async function listItems(client: Db | DbClient, userId: number): Promise<WatchlistItem[]> {
  const { rows } = await client.query<WatchlistRow>(
    `SELECT w.id, a.name AS author, ${UPCOMING_COUNT_SQL} AS upcoming_count, w.created_at
       FROM watchlist_items w JOIN authors a ON a.id = w.author_id
      WHERE w.user_id = $1
      ORDER BY a.name`,
    [userId],
  );
  return rows.map(toItem);
}

/** True if this user already follows an author with exactly this name. */
export async function isWatching(client: Db | DbClient, userId: number, authorName: string): Promise<boolean> {
  const { rowCount } = await client.query(
    `SELECT 1 FROM watchlist_items w JOIN authors a ON a.id = w.author_id WHERE w.user_id = $1 AND a.name = $2`,
    [userId, authorName],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Adds an author to the user's watchlist and writes the audit row, on the
 * caller's transaction. Throws HttpError 409 if already followed.
 */
export async function addItem(
  client: DbClient,
  actor: Principal,
  authorName: string,
  requestId: string,
): Promise<WatchlistItem> {
  const userId = await upsertUser(client, actor);
  // Following an author who has no releases in the catalog yet is allowed.
  const author = await client.query<{ id: string }>(
    `INSERT INTO authors (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [authorName],
  );
  let insertedId: number;
  try {
    // A savepoint, so a duplicate doesn't abort the caller's whole transaction.
    await client.query("SAVEPOINT add_watch");
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO watchlist_items (user_id, author_id) VALUES ($1, $2) RETURNING id`,
      [userId, author.rows[0]?.id],
    );
    await client.query("RELEASE SAVEPOINT add_watch");
    insertedId = Number(inserted.rows[0]?.id);
  } catch (err) {
    await client.query("ROLLBACK TO SAVEPOINT add_watch");
    if (isUniqueViolation(err, "watchlist_items_user_id_author_id_key")) {
      throw new HttpError(409, "conflict", `You are already watching ${authorName}`);
    }
    throw err;
  }
  const created = await getItem(client, userId, insertedId);
  if (!created) throw new Error("watchlist item vanished right after insert");
  await writeAudit(client, {
    actor,
    action: "watchlist.add",
    entityType: "watchlist_item",
    entityId: created.id,
    before: null,
    after: created,
    requestId,
  });
  return created;
}
