import { Router } from "express";
import { writeAudit } from "../audit.js";
import { principalOf, requireAuth, SCOPES, type Principal, type TokenVerifier } from "../auth.js";
import { isUniqueViolation, withTransaction, type Db, type DbClient } from "../db.js";
import { HttpError } from "../errors.js";
import { AddWatchlistBody, IdParam } from "../validation.js";

/**
 * /api/me/watchlist — the signed-in user's followed authors.
 *
 *   GET    /api/me/watchlist        Reader or Curator   200, 401, 403
 *   POST   /api/me/watchlist        Reader or Curator   201 + Location, 400, 401, 403, 409
 *   DELETE /api/me/watchlist/:id    Reader or Curator   204, 400, 401, 403, 404
 *
 * "me" is always the token's subject. Another user's item id returns 404, not
 * 403, so the API doesn't reveal which ids exist.
 */

interface WatchlistItem {
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
async function upsertUser(client: Db | DbClient, p: Principal): Promise<number> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO users (idp_subject, display_name) VALUES ($1, $2)
     ON CONFLICT (idp_subject) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
    [p.subject, p.name],
  );
  return Number(rows[0]?.id);
}

async function getItem(client: Db | DbClient, userId: number, itemId: number): Promise<WatchlistItem | null> {
  const { rows } = await client.query<WatchlistRow>(
    `SELECT w.id, a.name AS author, ${UPCOMING_COUNT_SQL} AS upcoming_count, w.created_at
       FROM watchlist_items w JOIN authors a ON a.id = w.author_id
      WHERE w.id = $1 AND w.user_id = $2`,
    [itemId, userId],
  );
  const row = rows[0];
  return row ? toItem(row) : null;
}

export function watchlistRouter(db: Db, verify: TokenVerifier): Router {
  const router = Router();
  router.use(requireAuth(verify, { scope: SCOPES.watchlist, roles: ["Reader", "Curator"] }));

  router.get("/", async (_req, res) => {
    const userId = await upsertUser(db, principalOf(res.locals));
    const { rows } = await db.query<WatchlistRow>(
      `SELECT w.id, a.name AS author, ${UPCOMING_COUNT_SQL} AS upcoming_count, w.created_at
         FROM watchlist_items w JOIN authors a ON a.id = w.author_id
        WHERE w.user_id = $1
        ORDER BY a.name`,
      [userId],
    );
    res.set("Cache-Control", "private, no-store"); // personal data: never shared-cached (D6)
    res.json({ items: rows.map(toItem) });
  });

  router.post("/", async (req, res) => {
    const { authorName } = AddWatchlistBody.parse(req.body);
    const actor = principalOf(res.locals);
    try {
      const item = await withTransaction(db, async (client) => {
        const userId = await upsertUser(client, actor);
        // Following an author who has no releases in the catalog yet is allowed.
        const author = await client.query<{ id: string }>(
          `INSERT INTO authors (name) VALUES ($1)
           ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
          [authorName],
        );
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO watchlist_items (user_id, author_id) VALUES ($1, $2) RETURNING id`,
          [userId, author.rows[0]?.id],
        );
        const created = await getItem(client, userId, Number(inserted.rows[0]?.id));
        if (!created) throw new Error("watchlist item vanished right after insert");
        await writeAudit(client, {
          actor,
          action: "watchlist.add",
          entityType: "watchlist_item",
          entityId: created.id,
          before: null,
          after: created,
          requestId: res.locals.requestId as string,
        });
        return created;
      });
      res.set("Cache-Control", "private, no-store");
      res.status(201).location(`/api/me/watchlist/${item.id}`).json(item);
    } catch (err) {
      if (isUniqueViolation(err, "watchlist_items_user_id_author_id_key")) {
        throw new HttpError(409, "conflict", `You are already watching ${authorName}`);
      }
      throw err;
    }
  });

  router.delete("/:id", async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const actor = principalOf(res.locals);
    await withTransaction(db, async (client) => {
      const userId = await upsertUser(client, actor);
      const before = await getItem(client, userId, id);
      if (!before) throw new HttpError(404, "not_found", `Watchlist item ${id} not found`);
      await client.query(`DELETE FROM watchlist_items WHERE id = $1 AND user_id = $2`, [id, userId]);
      await writeAudit(client, {
        actor,
        action: "watchlist.remove",
        entityType: "watchlist_item",
        entityId: id,
        before,
        after: null,
        requestId: res.locals.requestId as string,
      });
    });
    res.status(204).end();
  });

  return router;
}
