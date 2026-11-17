/**
 * Builds a Google Books `q` string from separate search fields, using Google's
 * documented keywords: intitle:, inauthor:, subject:, inpublisher:, isbn:.
 * https://developers.google.com/books/docs/v1/using#PerformingSearch
 *
 *   { title: "dune", author: "Frank Herbert" }  ->  intitle:"dune" inauthor:"Frank Herbert"
 *
 * Values are wrapped in quotes so multi-word names stay together; any quotes
 * the user typed are removed so they can't break out of the field.
 *
 * Google has NO date filter, so year / upcoming filtering happens on our side
 * after the results come back (see routes/books.ts).
 */
export interface SearchFields {
  q?: string | undefined; // free-text keywords
  title?: string | undefined;
  author?: string | undefined;
  subject?: string | undefined;
  publisher?: string | undefined;
  isbn?: string | undefined;
}

const clean = (v: string) => v.replace(/["“”]/g, "").replace(/\s+/g, " ").trim();

export function buildGoogleQuery(f: SearchFields): string {
  const parts: string[] = [];
  if (f.q && clean(f.q)) parts.push(clean(f.q));
  if (f.title && clean(f.title)) parts.push(`intitle:"${clean(f.title)}"`);
  if (f.author && clean(f.author)) parts.push(`inauthor:"${clean(f.author)}"`);
  if (f.subject && clean(f.subject)) parts.push(`subject:"${clean(f.subject)}"`);
  if (f.publisher && clean(f.publisher)) parts.push(`inpublisher:"${clean(f.publisher)}"`);
  if (f.isbn) parts.push(`isbn:${f.isbn.replace(/[^0-9Xx]/g, "")}`);
  return parts.join(" ");
}
