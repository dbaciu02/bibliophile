import { z } from "zod";

/**
 * Runtime validation of Google Books responses (F10). We only describe the
 * fields we use; anything else Google adds is ignored. A response that doesn't
 * match is treated like an outage, never passed on half-parsed.
 *
 * Docs: https://developers.google.com/books/docs/v1/reference/volumes
 */

const ImageLinks = z
  .object({
    smallThumbnail: z.string().optional(),
    thumbnail: z.string().optional(),
  })
  .optional();

const VolumeInfo = z.object({
  title: z.string().min(1),
  authors: z.array(z.string()).optional(),
  publishedDate: z.string().optional(),
  categories: z.array(z.string()).optional(),
  imageLinks: ImageLinks,
});

export const GoogleVolume = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  volumeInfo: VolumeInfo,
});
export type GoogleVolume = z.infer<typeof GoogleVolume>;

export const GoogleVolumeList = z.object({
  totalItems: z.number().int().nonnegative(),
  // Google leaves `items` out entirely when there are no results.
  items: z.array(GoogleVolume).optional(),
});
export type GoogleVolumeList = z.infer<typeof GoogleVolumeList>;
