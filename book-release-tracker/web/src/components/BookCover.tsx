import { genreClass } from "../genre";

/**
 * A book's cover: the real thumbnail when Google Books has one, otherwise a
 * cloth-bound "cover" in the genre's colour with the title on it. Decorative:
 * the title, authors and genre are always in the text beside it.
 */
export function BookCover({ title, thumbnailUrl, categories }: { title: string; thumbnailUrl: string | null; categories: readonly string[] }) {
  if (thumbnailUrl) return <img className="cover" src={thumbnailUrl} alt="" width={64} height={96} loading="lazy" />;
  return (
    // The title is drawn by CSS from data-title, so it isn't duplicated in the
    // page's text (screen readers, find-in-page, tests see it once).
    <div className={`cover cover-made ${genreClass(categories)}`} data-title={title} aria-hidden="true" />
  );
}
