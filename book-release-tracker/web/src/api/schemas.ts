import { z } from "zod";

/**
 * Runtime checks for every API response the UI uses. The server is ours, but
 * the browser still verifies what it receives: a deploy mismatch or a proxy
 * error page then shows as a clear error state instead of a broken page.
 */

export const DatePrecision = z.enum(["year", "month", "day"]);
export type DatePrecision = z.infer<typeof DatePrecision>;

export const Release = z.object({
  id: z.number().int(),
  googleVolumeId: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  releaseDate: z.iso.date(),
  datePrecision: DatePrecision,
  categories: z.array(z.string()),
  thumbnailUrl: z.string().nullable(),
  updatedAt: z.string(),
});
export type Release = z.infer<typeof Release>;

export const ReleasePage = z.object({
  items: z.array(Release),
  nextOffset: z.number().int().nullable(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type ReleasePage = z.infer<typeof ReleasePage>;

export const WatchlistItem = z.object({
  id: z.number().int(),
  author: z.string(),
  upcomingCount: z.number().int(),
  createdAt: z.string(),
});
export type WatchlistItem = z.infer<typeof WatchlistItem>;

export const Watchlist = z.object({ items: z.array(WatchlistItem) });
export type Watchlist = z.infer<typeof Watchlist>;

export const BookCandidate = z.object({
  googleVolumeId: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  publishedDateRaw: z.string().nullable(),
  releaseDate: z.iso.date().nullable(),
  datePrecision: DatePrecision.nullable(),
  categories: z.array(z.string()),
  thumbnailUrl: z.string().nullable(),
  inCatalog: z.boolean(),
});
export type BookCandidate = z.infer<typeof BookCandidate>;

export const BookSearch = z.object({
  items: z.array(BookCandidate),
  totalItems: z.number().int(),
  hiddenByDateFilter: z.number().int(),
  googleQuery: z.string(),
  source: z.enum(["live", "cache", "stale"]),
  fetchedAt: z.string(),
});
export type BookSearch = z.infer<typeof BookSearch>;

export const Me = z.object({
  subject: z.string(),
  name: z.string(),
  roles: z.array(z.string()),
  scopes: z.array(z.string()),
});
export type Me = z.infer<typeof Me>;

export const Health = z.object({ status: z.string(), commit: z.string() });
export type Health = z.infer<typeof Health>;

// Stable parse functions for useRemote (module-level = same reference every render).
export const parseReleasePage = (j: unknown) => ReleasePage.parse(j);
export const parseWatchlist = (j: unknown) => Watchlist.parse(j);
export const parseBookSearch = (j: unknown) => BookSearch.parse(j);
export const parseMe = (j: unknown) => Me.parse(j);
export const parseHealth = (j: unknown) => Health.parse(j);
