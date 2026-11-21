import { Router, type Response } from "express";
import { writeAudit } from "../audit.js";
import { emitEvent } from "../events/emit.js";
import { principalOf, requireAuth, SCOPES, type TokenVerifier } from "../auth.js";
import { isUniqueViolation, withTransaction, type Db } from "../db.js";
import { HttpError } from "../errors.js";
import { getRelease, hideRelease, insertRelease, listReleases, updateRelease } from "../repositories/releases.js";
import { CreateReleaseBody, IdParam, ListReleasesQuery, UpdateReleaseBody } from "../validation.js";
import { rateLimit } from "../rateLimit.js";

/**
 * /api/releases — the public catalog.
 *
 *   GET    /api/releases          public    200, 400
 *   GET    /api/releases/:id      public    200, 400, 404
 *   POST   /api/releases          Curator   201 + Location, 400, 401, 403, 409
 *   PATCH  /api/releases/:id      Curator   200, 400, 401, 403, 404
 *   DELETE /api/releases/:id      Curator   204, 400, 401, 403, 404   (soft hide)
 *
 * POST /api/releases/import (fill a release from Google Books) is in routes/import.ts.
 */
/**
 * D6: the public catalog is the one API class a shared cache may keep.
 * The site proxies GET /api/releases* through Netlify (same origin), and
 * Netlify's CDN stores a 200 for 60 s, keyed by path + query string. Browsers
 * always revalidate (ETag -> 304), so they never hold a stale copy themselves.
 * Live updates refetch with `?v=<event id>`: a new cache key per change, so a
 * change shows at once even though older keys may live out their 60 s.
 * Only successful reads are cached; errors fall through with no cache headers.
 */
export const PUBLIC_CDN_TTL_SECONDS = 60;
function publicCacheHeaders(res: Response): void {
  res.set("Cache-Control", "public, max-age=0, must-revalidate");
  res.set("Netlify-CDN-Cache-Control", `public, max-age=${PUBLIC_CDN_TTL_SECONDS}`);
  res.set("Netlify-Vary", "query");
  res.set("Netlify-Cache-Tag", "releases");
}

export function releasesRouter(db: Db, verify: TokenVerifier): Router {
  const router = Router();
  const curatorAuth = requireAuth(verify, { scope: SCOPES.releasesWrite, roles: ["Curator"] });
  // S1: write routes are limited per user, after the auth check.
  const writeLimit = rateLimit({ name: "releases-write", limit: 120, windowMs: 60_000 });

  router.get("/", async (req, res) => {
    const query = ListReleasesQuery.parse(req.query);
    const page = await listReleases(db, query);
    publicCacheHeaders(res);
    res.json({ ...page, limit: query.limit, offset: query.offset });
  });

  router.get("/:id", async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const release = await getRelease(db, id);
    if (!release) throw new HttpError(404, "not_found", `Release ${id} not found`);
    publicCacheHeaders(res);
    res.json(release);
  });

  router.post("/", curatorAuth, writeLimit, async (req, res) => {
    const body = CreateReleaseBody.parse(req.body);
    const actor = principalOf(res.locals);
    try {
      const created = await withTransaction(db, async (client) => {
        const release = await insertRelease(client, body);
        await emitEvent(client, {
          type: "release.created",
          payload: { id: release.id, title: release.title, releaseDate: release.releaseDate },
        });
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

  router.patch("/:id", curatorAuth, writeLimit, async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const changes = UpdateReleaseBody.parse(req.body);
    const actor = principalOf(res.locals);
    const updated = await withTransaction(db, async (client) => {
      const before = await getRelease(client, id, { forUpdate: true });
      if (!before) throw new HttpError(404, "not_found", `Release ${id} not found`);
      const after = await updateRelease(client, id, changes);
      await emitEvent(client, {
        type: "release.updated",
        payload: { id, title: after.title, releaseDate: after.releaseDate },
      });
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

  router.delete("/:id", curatorAuth, writeLimit, async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const actor = principalOf(res.locals);
    await withTransaction(db, async (client) => {
      const before = await getRelease(client, id, { forUpdate: true });
      if (!before) throw new HttpError(404, "not_found", `Release ${id} not found`);
      await hideRelease(client, id);
      await emitEvent(client, { type: "release.hidden", payload: { id } });
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
