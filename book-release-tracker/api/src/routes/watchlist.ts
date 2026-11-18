import { Router } from "express";
import { writeAudit } from "../audit.js";
import { principalOf, requireAuth, SCOPES, type TokenVerifier } from "../auth.js";
import { withTransaction, type Db } from "../db.js";
import { HttpError } from "../errors.js";
import { addItem, getItem, listItems, upsertUser } from "../repositories/watchlist.js";
import { AddWatchlistBody, IdParam } from "../validation.js";

/**
 * /api/me/watchlist — the signed-in user's followed authors.
 *
 *   GET    /api/me/watchlist        Reader or Curator   200, 401, 403
 *   POST   /api/me/watchlist        Reader or Curator   201 + Location, 400, 401, 403, 409
 *   DELETE /api/me/watchlist/:id    Reader or Curator   204, 400, 401, 403, 404
 *
 * "me" is always the token's subject. Another user's item id returns 404, not
 * 403, so the API doesn't reveal which ids exist. The data access is shared
 * with the MCP tools (repositories/watchlist.ts).
 */
export function watchlistRouter(db: Db, verify: TokenVerifier): Router {
  const router = Router();
  router.use(requireAuth(verify, { scope: SCOPES.watchlist, roles: ["Reader", "Curator"] }));

  router.get("/", async (_req, res) => {
    const userId = await upsertUser(db, principalOf(res.locals));
    const items = await listItems(db, userId);
    res.set("Cache-Control", "private, no-store"); // personal data: never shared-cached (D6)
    res.json({ items });
  });

  router.post("/", async (req, res) => {
    const { authorName } = AddWatchlistBody.parse(req.body);
    const actor = principalOf(res.locals);
    const item = await withTransaction(db, (client) => addItem(client, actor, authorName, res.locals.requestId as string));
    res.set("Cache-Control", "private, no-store");
    res.status(201).location(`/api/me/watchlist/${item.id}`).json(item);
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
