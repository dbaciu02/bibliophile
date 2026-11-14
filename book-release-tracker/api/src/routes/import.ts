import { Router } from "express";
import { z } from "zod";
import { writeAudit } from "../audit.js";
import { principalOf, requireAuth, SCOPES, type TokenVerifier } from "../auth.js";
import { isUniqueViolation, withTransaction, type Db } from "../db.js";
import { HttpError } from "../errors.js";
import type { BooksService } from "../googleBooks/cachedBooks.js";
import { toHttpError } from "../googleBooks/httpErrors.js";
import { toCandidate } from "../googleBooks/mapping.js";
import { rateLimit } from "../rateLimit.js";
import { insertRelease } from "../repositories/releases.js";
import type { CreateRelease } from "../validation.js";

/**
 * POST /api/releases/import   Curator only
 *   body: { "googleVolumeId": "…" }
 *   201 + Location, 400, 401, 403, 404, 409, 429, 503
 *
 * Looks the volume up in Google Books (through the cache) and adds it to the
 * catalog. 400 when Google's record can't be used as a release (no usable
 * date or no author) — the curator can then add it by hand with POST /api/releases.
 */
const ImportBody = z.strictObject({
  googleVolumeId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Must be a Google Books volume id"),
});

export function importRouter(db: Db, verify: TokenVerifier, books: BooksService): Router {
  const router = Router();

  router.post(
    "/",
    requireAuth(verify, { scope: SCOPES.releasesWrite, roles: ["Curator"] }),
    rateLimit({ name: "releases-import", limit: 20, windowMs: 60_000 }),
    async (req, res) => {
      const { googleVolumeId } = ImportBody.parse(req.body);
      const actor = principalOf(res.locals);

      // Cheap check first, so a duplicate never spends Google quota.
      const existing = await db.query(`SELECT 1 FROM books WHERE google_volume_id = $1`, [googleVolumeId]);
      if (existing.rowCount) {
        throw new HttpError(409, "conflict", `Volume ${googleVolumeId} is already in the catalog`);
      }

      let volume;
      try {
        volume = await books.getVolume(googleVolumeId);
      } catch (err) {
        throw toHttpError(err);
      }

      const c = toCandidate(volume.data);
      const problems = [];
      if (!c.releaseDate || !c.datePrecision) {
        problems.push({
          path: "publishedDate",
          message: `Google Books has no usable release date (${JSON.stringify(c.publishedDateRaw)}); add this book with POST /api/releases instead`,
        });
      }
      if (c.authors.length === 0) {
        problems.push({ path: "authors", message: "Google Books lists no author; add this book with POST /api/releases instead" });
      }
      if (problems.length > 0) {
        throw new HttpError(400, "validation_failed", "This Google Books volume can't be imported as-is", problems);
      }

      const input: CreateRelease = {
        googleVolumeId: c.googleVolumeId,
        title: c.title,
        publishedDate: { date: c.releaseDate as string, precision: c.datePrecision as NonNullable<typeof c.datePrecision> },
        authors: c.authors,
        categories: c.categories,
        thumbnailUrl: c.thumbnailUrl,
      };

      try {
        const created = await withTransaction(db, async (client) => {
          const release = await insertRelease(client, input);
          await writeAudit(client, {
            actor,
            action: "release.import",
            entityType: "book",
            entityId: release.id,
            before: null,
            // Record where the data came from, so the audit trail shows it wasn't typed by hand.
            after: { ...release, importedFrom: { provider: "google_books", source: volume.source, fetchedAt: volume.fetchedAt } },
            requestId: res.locals.requestId as string,
          });
          return release;
        });
        res.status(201).location(`/api/releases/${created.id}`).json({ ...created, importSource: volume.source });
      } catch (err) {
        // Two curators importing the same volume at the same moment.
        if (isUniqueViolation(err, "books_google_volume_id_key")) {
          throw new HttpError(409, "conflict", `Volume ${googleVolumeId} is already in the catalog`);
        }
        throw err;
      }
    },
  );

  return router;
}
