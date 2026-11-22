import { z } from "zod/mini";

/**
 * Runtime checks for every API response the UI uses. The server is ours, but
 * the browser still verifies what it receives: a deploy mismatch or a proxy
 * error page then shows as a clear error state instead of a broken page.
 *
 * Uses `zod/mini` (D8): the same validation as full zod, but tree-shakable,
 * so the browser only downloads the checks used here. Its API is functional:
 * z.nullable(x) instead of x.nullable(), z.int() instead of z.number().int().
 */

export const DatePrecision = z.enum(["year", "month", "day"]);
export type DatePrecision = z.infer<typeof DatePrecision>;

export const Release = z.object({
  id: z.int(),
  googleVolumeId: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  releaseDate: z.iso.date(),
  datePrecision: DatePrecision,
  categories: z.array(z.string()),
  thumbnailUrl: z.nullable(z.string()),
  updatedAt: z.string(),
});
export type Release = z.infer<typeof Release>;

export const ReleasePage = z.object({
  items: z.array(Release),
  nextOffset: z.nullable(z.int()),
  limit: z.int(),
  offset: z.int(),
});
export type ReleasePage = z.infer<typeof ReleasePage>;

export const WatchlistItem = z.object({
  id: z.int(),
  author: z.string(),
  upcomingCount: z.int(),
  createdAt: z.string(),
});
export type WatchlistItem = z.infer<typeof WatchlistItem>;

export const Watchlist = z.object({ items: z.array(WatchlistItem) });
export type Watchlist = z.infer<typeof Watchlist>;

export const BookCandidate = z.object({
  googleVolumeId: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  publishedDateRaw: z.nullable(z.string()),
  releaseDate: z.nullable(z.iso.date()),
  datePrecision: z.nullable(DatePrecision),
  categories: z.array(z.string()),
  thumbnailUrl: z.nullable(z.string()),
  inCatalog: z.boolean(),
});
export type BookCandidate = z.infer<typeof BookCandidate>;

export const BookSearch = z.object({
  items: z.array(BookCandidate),
  totalItems: z.int(),
  hiddenByDateFilter: z.int(),
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
