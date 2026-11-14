import { normalizePublishedDate, type DatePrecision } from "../lib/releaseDate.js";
import type { GoogleVolume } from "./schema.js";

/** A Google Books result as our API returns it from /api/books/search. */
export interface BookCandidate {
  googleVolumeId: string;
  title: string;
  authors: string[];
  publishedDateRaw: string | null; // exactly what Google said
  releaseDate: string | null; // normalized, or null if Google's date is missing/unusable
  datePrecision: DatePrecision | null;
  categories: string[];
  thumbnailUrl: string | null;
}

/**
 * Google often returns thumbnails as http://. Our pages are HTTPS-only (D2) and
 * our validation only accepts https URLs, so upgrade the scheme (Google serves
 * the same image over https). Anything that isn't a Google image URL is dropped.
 */
export function httpsThumbnail(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!/(^|\.)(google|googleusercontent|gstatic)\.com$/.test(parsed.hostname)) return null;
    parsed.protocol = "https:";
    return parsed.toString();
  } catch {
    return null;
  }
}

export function toCandidate(v: GoogleVolume): BookCandidate {
  const info = v.volumeInfo;
  const normalized = info.publishedDate ? normalizePublishedDate(info.publishedDate) : null;
  return {
    googleVolumeId: v.id,
    title: info.title.trim().slice(0, 500),
    authors: [...new Set((info.authors ?? []).map((a) => a.trim()).filter(Boolean))].slice(0, 20),
    publishedDateRaw: info.publishedDate ?? null,
    releaseDate: normalized?.date ?? null,
    datePrecision: normalized?.precision ?? null,
    categories: [...new Set((info.categories ?? []).map((c) => c.trim()).filter(Boolean))].slice(0, 20),
    thumbnailUrl: httpsThumbnail(info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail),
  };
}
