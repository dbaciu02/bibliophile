import type { Db, DbClient } from "../db.js";
import type { DatePrecision } from "../lib/releaseDate.js";
import type { CreateRelease, ListReleases, UpdateRelease } from "../validation.js";

/** A release as the API returns it. */
export interface Release {
  id: number;
  googleVolumeId: string;
  title: string;
  authors: string[];
  releaseDate: string; // first day of the period, YYYY-MM-DD
  datePrecision: DatePrecision;
  categories: string[];
  thumbnailUrl: string | null;
  updatedAt: string;
}

interface ReleaseRow {
  id: string;
  google_volume_id: string;
  title: string;
  authors: string[];
  published_date: string;
  date_precision: DatePrecision;
  categories: string[];
  thumbnail_url: string | null;
  updated_at: Date;
}

function toRelease(row: ReleaseRow): Release {
  return {
    id: Number(row.id),
    googleVolumeId: row.google_volume_id,
    title: row.title,
    authors: row.authors,
    releaseDate: row.published_date,
    datePrecision: row.date_precision,
    categories: row.categories,
    thumbnailUrl: row.thumbnail_url,
    updatedAt: row.updated_at.toISOString(),
  };
}

// Last day of a release's period, in SQL. Mirrors periodEnd() in lib/releaseDate.ts.
const PERIOD_END_SQL = `
  CASE b.date_precision
    WHEN 'day'   THEN b.published_date
    WHEN 'month' THEN (date_trunc('month', b.published_date) + interval '1 month - 1 day')::date
    ELSE              (date_trunc('year',  b.published_date) + interval '1 year - 1 day')::date
  END`;

// Same order as compareReleaseDates(): earliest first, exact dates before vaguer ones.
const ORDER_SQL = `
  ORDER BY b.published_date,
           CASE b.date_precision WHEN 'day' THEN 0 WHEN 'month' THEN 1 ELSE 2 END,
           b.id`;

const SELECT_SQL = `
  SELECT b.id, b.google_volume_id, b.title, b.published_date, b.date_precision,
         b.categories, b.thumbnail_url, b.updated_at,
         COALESCE(
           (SELECT array_agg(a.name ORDER BY a.name)
              FROM book_authors ba JOIN authors a ON a.id = ba.author_id
             WHERE ba.book_id = b.id),
           '{}') AS authors
    FROM books b`;

/** Escape %, _ and \ so user text is matched literally inside ILIKE. */
function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function listReleases(
  db: Db,
  q: ListReleases,
): Promise<{ items: Release[]; nextOffset: number | null }> {
  const where: string[] = ["NOT b.hidden"];
  const params: unknown[] = [];
  const param = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (q.from) {
    // A vague release overlaps the range if its period ENDS on/after `from`
    // ("2026-11" matches from=2026-11-20). The extra `published_date >` bound
    // lets Postgres use books_published_date_idx: no period is longer than a
    // year, so nothing starting a year or more before `from` can match.
    const p = param(q.from);
    where.push(`${PERIOD_END_SQL} >= ${p}::date`);
    where.push(`b.published_date > ${p}::date - interval '1 year'`);
  }
  if (q.to) where.push(`b.published_date <= ${param(q.to)}::date`);
  if (q.q) where.push(`b.title ILIKE '%' || ${param(likeLiteral(q.q))} || '%'`);
  if (q.category) where.push(`${param(q.category)} = ANY (b.categories)`);
  if (q.author) {
    where.push(`EXISTS (SELECT 1 FROM book_authors ba JOIN authors a ON a.id = ba.author_id
                         WHERE ba.book_id = b.id AND a.name ILIKE ${param(likeLiteral(q.author))})`);
  }

  // Fetch one extra row to know whether there is a next page.
  const sql = `${SELECT_SQL} WHERE ${where.join(" AND ")} ${ORDER_SQL}
               LIMIT ${param(q.limit + 1)} OFFSET ${param(q.offset)}`;
  const { rows } = await db.query<ReleaseRow>(sql, params);
  const hasMore = rows.length > q.limit;
  return {
    items: rows.slice(0, q.limit).map(toRelease),
    nextOffset: hasMore ? q.offset + q.limit : null,
  };
}

export async function getRelease(db: Db | DbClient, id: number, opts: { forUpdate?: boolean } = {}): Promise<Release | null> {
  const lock = opts.forUpdate ? "FOR UPDATE OF b" : "";
  const { rows } = await db.query<ReleaseRow>(`${SELECT_SQL} WHERE b.id = $1 AND NOT b.hidden ${lock}`, [id]);
  const row = rows[0];
  return row ? toRelease(row) : null;
}

async function setAuthors(client: DbClient, bookId: number, names: string[]): Promise<void> {
  await client.query(`DELETE FROM book_authors WHERE book_id = $1`, [bookId]);
  // Insert any new author names, then link all of them to the book.
  await client.query(
    `INSERT INTO authors (name) SELECT unnest($1::text[]) ON CONFLICT (name) DO NOTHING`,
    [names],
  );
  await client.query(
    `INSERT INTO book_authors (book_id, author_id)
     SELECT $1, id FROM authors WHERE name = ANY ($2::text[])`,
    [bookId, names],
  );
}

/** Throws a unique violation on books_google_volume_id_key if the volume is already in the catalog. */
export async function insertRelease(client: DbClient, input: CreateRelease): Promise<Release> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO books (google_volume_id, title, published_date, date_precision, categories, thumbnail_url)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      input.googleVolumeId,
      input.title,
      input.publishedDate.date,
      input.publishedDate.precision,
      input.categories,
      input.thumbnailUrl,
    ],
  );
  const id = Number(rows[0]?.id);
  await setAuthors(client, id, input.authors);
  const created = await getRelease(client, id);
  if (!created) throw new Error("release vanished right after insert");
  return created;
}

export async function updateRelease(client: DbClient, id: number, changes: UpdateRelease): Promise<Release> {
  const sets: string[] = ["updated_at = now()"];
  const params: unknown[] = [id];
  const set = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };
  if (changes.title !== undefined) set("title", changes.title);
  if (changes.publishedDate !== undefined) {
    set("published_date", changes.publishedDate.date);
    set("date_precision", changes.publishedDate.precision);
  }
  if (changes.categories !== undefined) set("categories", changes.categories);
  if (changes.thumbnailUrl !== undefined) set("thumbnail_url", changes.thumbnailUrl);

  await client.query(`UPDATE books SET ${sets.join(", ")} WHERE id = $1`, params);
  if (changes.authors !== undefined) await setAuthors(client, id, changes.authors);

  const updated = await getRelease(client, id);
  if (!updated) throw new Error("release vanished during update");
  return updated;
}

export async function hideRelease(client: DbClient, id: number): Promise<void> {
  await client.query(`UPDATE books SET hidden = true, updated_at = now() WHERE id = $1`, [id]);
}
