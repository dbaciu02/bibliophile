import { Router } from "express";
import { z } from "zod";
import { requireAuth, SCOPES, type TokenVerifier } from "../auth.js";
import type { Db } from "../db.js";
import type { BooksService } from "../googleBooks/cachedBooks.js";
import { toHttpError } from "../googleBooks/httpErrors.js";
import { toCandidate } from "../googleBooks/mapping.js";
import { rateLimit } from "../rateLimit.js";

/**
 * GET /api/books/search?q=…&maxResults=…   Curator only
 *   200 { items, totalItems, source, fetchedAt }, 400, 401, 403, 429, 503
 *
 * Searches Google Books (through the cache) so a curator can pick volumes to
 * import. Curator-only because every uncached call spends shared quota.
 * `source` is "live", "cache" or "stale" (Google down, older cached answer).
 */
const SearchQuery = z.strictObject({
  q: z.string().trim().min(2).max(200),
  maxResults: z.coerce.number().int().min(1).max(20).default(10),
});

export function booksRouter(db: Db, verify: TokenVerifier, books: BooksService): Router {
  const router = Router();

  router.get(
    "/search",
    requireAuth(verify, { scope: SCOPES.releasesWrite, roles: ["Curator"] }),
    rateLimit({ name: "books-search", limit: 30, windowMs: 60_000 }),
    async (req, res) => {
      const { q, maxResults } = SearchQuery.parse(req.query);
      let result;
      try {
        result = await books.search(q, maxResults);
      } catch (err) {
        throw toHttpError(err);
      }

      const candidates = (result.data.items ?? []).map(toCandidate);
      const ids = candidates.map((c) => c.googleVolumeId);
      const { rows } = await db.query<{ google_volume_id: string }>(
        `SELECT google_volume_id FROM books WHERE google_volume_id = ANY ($1::text[])`,
        [ids],
      );
      const inCatalog = new Set(rows.map((r) => r.google_volume_id));

      res.set("Cache-Control", "private, no-store");
      res.json({
        items: candidates.map((c) => ({ ...c, inCatalog: inCatalog.has(c.googleVolumeId) })),
        totalItems: result.data.totalItems,
        source: result.source,
        fetchedAt: result.fetchedAt,
      });
    },
  );

  return router;
}
