import { Router } from "express";
import { writeAudit } from "../audit.js";
import { principalOf, requireAuth, SCOPES, type TokenVerifier } from "../auth.js";
import { isUniqueViolation, withTransaction, type Db } from "../db.js";
import { HttpError } from "../errors.js";
import { getRelease, hideRelease, insertRelease, listReleases, updateRelease } from "../repositories/releases.js";
import { CreateReleaseBody, IdParam, ListReleasesQuery, UpdateReleaseBody } from "../validation.js";

/**
 * /api/releases — the public catalog.
 *
 *   GET    /api/releases          public    200, 400
 *   GET    /api/releases/:id      public    200, 400, 404
 *   POST   /api/releases          Curator   201 + Location, 400, 401, 403, 409
 *   PATCH  /api/releases/:id      Curator   200, 400, 401, 403, 404
 *   DELETE /api/releases/:id      Curator   204, 400, 401, 403, 404   (soft hide)
 *
 * Step 4 adds POST /api/releases/import, which fills the body from Google Books.
 */
export function releasesRouter(db: Db, verify: TokenVerifier): Router {
  const router = Router();
  const curatorOnly = requireAuth(verify, { scope: SCOPES.releasesWrite, roles: ["Curator"] });

  router.get("/", async (req, res) => {
    const query = ListReleasesQuery.parse(req.query);
    const page = await listReleases(db, query);
    res.json({ ...page, limit: query.limit, offset: query.offset });
  });

  router.get("/:id", async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const release = await getRelease(db, id);
    if (!release) throw new HttpError(404, "not_found", `Release ${id} not found`);
    res.json(release);
  });

  router.post("/", curatorOnly, async (req, res) => {
    const body = CreateReleaseBody.parse(req.body);
    const actor = principalOf(res.locals);
    try {
      const created = await withTransaction(db, async (client) => {
        const release = await insertRelease(client, body);
        await writeAudit(client, {
          actor,
          action: "release.create",
          entityType: "book",
          entityId: release.id,
          before: null,
          after: release,
          requestId: res.locals.requestId as string,
        });
        return release;
      });
      res.status(201).location(`/api/releases/${created.id}`).json(created);
    } catch (err) {
      if (isUniqueViolation(err, "books_google_volume_id_key")) {
        throw new HttpError(409, "conflict", `Volume ${body.googleVolumeId} is already in the catalog`);
      }
      throw err;
    }
  });

  router.patch("/:id", curatorOnly, async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const changes = UpdateReleaseBody.parse(req.body);
    const actor = principalOf(res.locals);
    const updated = await withTransaction(db, async (client) => {
      const before = await getRelease(client, id, { forUpdate: true });
      if (!before) throw new HttpError(404, "not_found", `Release ${id} not found`);
      const after = await updateRelease(client, id, changes);
      await writeAudit(client, {
        actor,
        action: "release.update",
        entityType: "book",
        entityId: id,
        before,
        after,
        requestId: res.locals.requestId as string,
      });
      return after;
    });
    res.json(updated);
  });

  router.delete("/:id", curatorOnly, async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const actor = principalOf(res.locals);
    await withTransaction(db, async (client) => {
      const before = await getRelease(client, id, { forUpdate: true });
      if (!before) throw new HttpError(404, "not_found", `Release ${id} not found`);
      await hideRelease(client, id);
      await writeAudit(client, {
        actor,
        action: "release.hide",
        entityType: "book",
        entityId: id,
        before,
        after: { ...before, hidden: true },
        requestId: res.locals.requestId as string,
      });
    });
    res.status(204).end();
  });

  return router;
}
