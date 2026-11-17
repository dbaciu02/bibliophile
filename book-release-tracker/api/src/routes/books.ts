import { Router } from "express";
import { z } from "zod";
import { requireAuth, SCOPES, type TokenVerifier } from "../auth.js";
import type { Db } from "../db.js";
import type { BooksService } from "../googleBooks/cachedBooks.js";
import { toHttpError } from "../googleBooks/httpErrors.js";
import { toCandidate, type BookCandidate } from "../googleBooks/mapping.js";
import { buildGoogleQuery } from "../googleBooks/query.js";
import { isUpcoming } from "../lib/releaseDate.js";
import { rateLimit } from "../rateLimit.js";

/**
 * GET /api/books/search   Curator only
 *   ?q=        free-text keywords
 *   ?title= ?author= ?subject= ?publisher= ?isbn=   Google's field searches
 *   ?orderBy=relevance|newest
 *   ?year=2027             only books whose release date falls in that year   (filtered by us)
 *   ?upcomingOnly=true     only books not released yet                        (filtered by us)
 *   ?maxResults=1..40      how many results to ask Google for (default 20)
 *
 *   200 { items, totalItems, hiddenByDateFilter, googleQuery, source, fetchedAt }
 *   400, 401, 403, 429, 503
 *
 * Google Books can't filter by date, so `year` and `upcomingOnly` are applied
 * here to the results Google returned; `hiddenByDateFilter` says how many were
 * dropped so the page can explain a short list. Books with no usable date are
 * dropped by either date filter. Curator-only because uncached calls spend quota.
 */
const field = (max: number) => z.string().trim().min(1).max(max).optional();

const SearchQuery = z
  .strictObject({
    q: field(200),
    title: field(200),
    author: field(200),
    subject: field(100),
    publisher: field(200),
    isbn: z
      .string()
      .trim()
      .regex(/^[0-9Xx-]{10,17}$/, "Must be an ISBN-10 or ISBN-13")
      .refine((v) => [10, 13].includes(v.replace(/-/g, "").length), "Must be an ISBN-10 or ISBN-13")
      .optional(),
    orderBy: z.enum(["relevance", "newest"]).default("relevance"),
    year: z.coerce.number().int().min(1000).max(2200).optional(),
    upcomingOnly: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
    maxResults: z.coerce.number().int().min(1).max(40).default(20),
  })
  .refine((s) => buildGoogleQuery(s).length >= 2, {
    message: "Enter at least one search field (keywords, title, author, subject, publisher or ISBN)",
    path: ["q"],
  });

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function passesDateFilter(c: BookCandidate, year: number | undefined, upcomingOnly: boolean, today: string): boolean {
  if (year === undefined && !upcomingOnly) return true;
  if (!c.releaseDate || !c.datePrecision) return false; // can't tell, so it can't match a date filter
  if (year !== undefined && Number(c.releaseDate.slice(0, 4)) !== year) return false;
  if (upcomingOnly && !isUpcoming({ date: c.releaseDate, precision: c.datePrecision }, today)) return false;
  return true;
}

export function booksRouter(db: Db, verify: TokenVerifier, books: BooksService): Router {
  const router = Router();

  router.get(
    "/search",
    requireAuth(verify, { scope: SCOPES.releasesWrite, roles: ["Curator"] }),
    rateLimit({ name: "books-search", limit: 30, windowMs: 60_000 }),
    async (req, res) => {
      const params = SearchQuery.parse(req.query);
      const googleQuery = buildGoogleQuery(params);

      let result;
      try {
        result = await books.search(googleQuery, params.maxResults, params.orderBy);
      } catch (err) {
        throw toHttpError(err);
      }

      const all = (result.data.items ?? []).map(toCandidate);
      const today = todayUtc();
      const kept = all.filter((c) => passesDateFilter(c, params.year, params.upcomingOnly, today));

      const { rows } = await db.query<{ google_volume_id: string }>(
        `SELECT google_volume_id FROM books WHERE google_volume_id = ANY ($1::text[])`,
        [kept.map((c) => c.googleVolumeId)],
      );
      const inCatalog = new Set(rows.map((r) => r.google_volume_id));

      res.set("Cache-Control", "private, no-store");
      res.json({
        items: kept.map((c) => ({ ...c, inCatalog: inCatalog.has(c.googleVolumeId) })),
        totalItems: result.data.totalItems,
        hiddenByDateFilter: all.length - kept.length,
        googleQuery,
        source: result.source,
        fetchedAt: result.fetchedAt,
      });
    },
  );

  return router;
}
