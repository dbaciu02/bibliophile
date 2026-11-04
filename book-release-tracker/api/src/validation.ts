import { z } from "zod";
import { normalizePublishedDate } from "./lib/releaseDate.js";

// Server-side validation for every request (F3). Schemas are "strict": an
// unknown field or query parameter is a 400, not silently ignored, so typos
// like ?form=2026-11-01 are caught instead of returning unfiltered results.

const trimmed = (max: number) => z.string().trim().min(1).max(max);

export const IdParam = z.strictObject({
  id: z.coerce.number().int().positive().max(2_147_483_647),
});

/** Google Books' publishedDate, normalized to { date, precision } (see lib/releaseDate.ts). */
const PublishedDate = z
  .string()
  .transform((raw, ctx) => {
    const normalized = normalizePublishedDate(raw);
    if (!normalized) {
      ctx.addIssue({ code: "custom", message: 'Must be "YYYY", "YYYY-MM" or a real "YYYY-MM-DD" date' });
      return z.NEVER;
    }
    return normalized;
  });

const Authors = z
  .array(trimmed(200))
  .min(1)
  .max(20)
  .transform((names) => [...new Set(names)]); // ignore exact duplicates

const Categories = z
  .array(trimmed(100))
  .max(20)
  .transform((c) => [...new Set(c)]);

const ThumbnailUrl = z.url({ protocol: /^https$/ }).max(2000).nullable();

export const CreateReleaseBody = z.strictObject({
  googleVolumeId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Must be a Google Books volume id"),
  title: trimmed(500),
  publishedDate: PublishedDate,
  authors: Authors,
  categories: Categories.default([]),
  thumbnailUrl: ThumbnailUrl.default(null),
});
export type CreateRelease = z.infer<typeof CreateReleaseBody>;

export const UpdateReleaseBody = z
  .strictObject({
    title: trimmed(500),
    publishedDate: PublishedDate,
    authors: Authors,
    categories: Categories,
    thumbnailUrl: ThumbnailUrl,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Provide at least one field to change" });
export type UpdateRelease = z.infer<typeof UpdateReleaseBody>;

export const ListReleasesQuery = z
  .strictObject({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    q: trimmed(200).optional(),
    category: trimmed(100).optional(),
    author: trimmed(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(10_000).default(0),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '"from" must be on or before "to"', path: ["from"] });
export type ListReleases = z.infer<typeof ListReleasesQuery>;

export const AddWatchlistBody = z.strictObject({
  authorName: trimmed(200),
});
