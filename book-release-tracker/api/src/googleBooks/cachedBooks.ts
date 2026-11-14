import type { z } from "zod";
import type { Db } from "../db.js";
import { GoogleBooksError, type GoogleBooksClient } from "./client.js";
import { GoogleVolume, GoogleVolumeList } from "./schema.js";

/**
 * Google Books with a Postgres cache in front (F10).
 *
 * Why cache: the default quota is about 1,000 requests per day per project
 * (check yours under Google Cloud → APIs & Services → Books API → Quotas).
 * Curators repeat the same searches; caching keeps us far under the quota and
 * makes repeat searches instant.
 *
 * TTLs: searches 6 hours (new books appear, but not minute by minute);
 * single volumes 24 hours (a book's details rarely change within a day).
 *
 * Graceful degradation: if Google is down (timeout, 5xx after retries, bad
 * response, circuit open), an EXPIRED cache entry is returned marked
 * `source: "stale"` instead of failing. Only when there is nothing cached at
 * all does the caller get an error (which becomes a 503).
 */

export const SEARCH_TTL_SECONDS = 6 * 60 * 60;
export const VOLUME_TTL_SECONDS = 24 * 60 * 60;

export type Source = "live" | "cache" | "stale";

export interface Cached<T> {
  data: T;
  source: Source;
  fetchedAt: string; // when Google actually answered
}

export interface BooksService {
  search(query: string, maxResults: number): Promise<Cached<GoogleVolumeList>>;
  getVolume(volumeId: string): Promise<Cached<GoogleVolume>>;
}

interface CacheRow {
  body: unknown;
  fetched_at: Date;
  fresh: boolean;
}

/** Which failures we're allowed to paper over with stale data. */
function isOutage(err: unknown): boolean {
  return (
    err instanceof GoogleBooksError &&
    (err.kind === "unavailable" || err.kind === "circuit_open" || err.kind === "invalid_response")
  );
}

export function createBooksService(db: Db, client: GoogleBooksClient): BooksService {
  async function read(key: string): Promise<CacheRow | null> {
    const { rows } = await db.query<CacheRow>(
      `SELECT body, fetched_at, expires_at > now() AS fresh FROM google_books_cache WHERE cache_key = $1`,
      [key],
    );
    return rows[0] ?? null;
  }

  async function write(key: string, body: unknown, ttlSeconds: number): Promise<Date> {
    const { rows } = await db.query<{ fetched_at: Date }>(
      `INSERT INTO google_books_cache (cache_key, body, fetched_at, expires_at)
       VALUES ($1, $2, now(), now() + make_interval(secs => $3))
       ON CONFLICT (cache_key) DO UPDATE
         SET body = EXCLUDED.body, fetched_at = EXCLUDED.fetched_at, expires_at = EXCLUDED.expires_at
       RETURNING fetched_at`,
      [key, JSON.stringify(body), ttlSeconds],
    );
    return rows[0]?.fetched_at ?? new Date();
  }

  async function cached<T>(
    key: string,
    ttlSeconds: number,
    schema: z.ZodType<T>,
    load: () => Promise<T>,
  ): Promise<Cached<T>> {
    const row = await read(key);
    // Re-validate what we stored too: the schema may have changed since it was written.
    const stored = row ? schema.safeParse(row.body) : null;

    if (row && stored?.success && row.fresh) {
      return { data: stored.data, source: "cache", fetchedAt: row.fetched_at.toISOString() };
    }

    try {
      const data = await load();
      const fetchedAt = await write(key, data, ttlSeconds);
      return { data, source: "live", fetchedAt: fetchedAt.toISOString() };
    } catch (err) {
      if (isOutage(err) && row && stored?.success) {
        return { data: stored.data, source: "stale", fetchedAt: row.fetched_at.toISOString() };
      }
      throw err;
    }
  }

  return {
    search: (query, maxResults) =>
      cached(
        `search:${maxResults}:${query.trim().toLowerCase()}`,
        SEARCH_TTL_SECONDS,
        GoogleVolumeList,
        () => client.search(query, maxResults),
      ),
    getVolume: (volumeId) =>
      cached(`volume:${volumeId}`, VOLUME_TTL_SECONDS, GoogleVolume, () => client.getVolume(volumeId)),
  };
}
