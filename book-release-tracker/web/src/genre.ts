/**
 * Genre colours for book covers and tags (visual only: the genre is always
 * written out next to it, so colour never carries meaning on its own).
 * Colours live in styles.css as .genre-<slug>; anything unknown gets the
 * default warm brown.
 */
const KNOWN = new Set([
  "fiction",
  "fantasy",
  "mystery",
  "romance",
  "science-fiction",
  "thriller",
  "historical-fiction",
  "young-adult",
  "poetry",
  "essays",
  "history",
  "biography",
  "nonfiction",
  "horror",
  "memoir",
  "travel",
]);

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function genreSlug(category: string | undefined): string {
  // Google Books often sends "Fiction / Fantasy / Epic": the most specific
  // known part wins, so check the parts from the end.
  const parts = [category ?? "", ...(category ?? "").split("/").reverse()].map((p) => slugify(p.trim()));
  return parts.find((p) => KNOWN.has(p)) ?? "default";
}

/** The class for a book: its first category decides the colour. */
export function genreClass(categories: readonly string[]): string {
  return `genre-${genreSlug(categories[0])}`;
}
