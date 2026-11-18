import type { Principal } from "../auth.js";
import { writeAudit } from "../audit.js";
import { withTransaction, type Db, type DbClient } from "../db.js";
import { emitEvent } from "../events/emit.js";
import { insertRelease } from "../repositories/releases.js";
import { SAMPLE_BOOKS, sampleDate, type SampleBook } from "./sampleBooks.js";

/**
 * Adds or removes the invented sample books. They go through the same code as
 * a curator's POST /api/releases: same rules, an audit row each, and a
 * live-update event each, so open pages show them appear.
 *
 * Each command runs in ONE transaction: fast (no commit per book) and
 * all-or-nothing (a failure halfway leaves the catalog exactly as it was).
 *
 * The audit actor is "system:seed-script". That's honest: no person did it,
 * and it's easy to filter out of audit evidence.
 */

export const SEED_PREFIX = "seed-";
const SEED_ACTOR: Principal = { subject: "system:seed-script", name: "Seed script", roles: [], scopes: [] };

interface ExistingRow {
  id: string;
  google_volume_id: string;
  hidden: boolean;
}

export async function seedCatalog(
  db: Db,
  today: string,
): Promise<{ added: number; restored: number; skipped: number }> {
  return withTransaction(db, async (client) => {
    const existing = await client.query<ExistingRow>(
      `SELECT id, google_volume_id, hidden FROM books WHERE google_volume_id LIKE $1`,
      [`${SEED_PREFIX}%`],
    );
    const have = new Map(existing.rows.map((r) => [r.google_volume_id, r]));
    let added = 0;
    let restored = 0;

    for (const book of SAMPLE_BOOKS) {
      const row = have.get(`${SEED_PREFIX}${book.key}`);
      if (row && !row.hidden) continue; // already showing: leave it alone
      if (row) {
        await restoreBook(client, Number(row.id), book, today); // removed earlier with seed:remove
        restored += 1;
      } else {
        await addBook(client, book, today);
        added += 1;
      }
    }
    return { added, restored, skipped: SAMPLE_BOOKS.length - added - restored };
  });
}

async function addBook(client: DbClient, book: SampleBook, today: string): Promise<void> {
  const release = await insertRelease(client, {
    googleVolumeId: `${SEED_PREFIX}${book.key}`,
    title: book.title,
    publishedDate: { date: sampleDate(today, book.offsetDays, book.precision), precision: book.precision },
    authors: book.authors,
    categories: book.categories,
    thumbnailUrl: null,
  });
  await emitEvent(client, {
    type: "release.created",
    payload: { id: release.id, title: release.title, releaseDate: release.releaseDate },
  });
  await writeAudit(client, {
    actor: SEED_ACTOR,
    action: "release.create",
    entityType: "book",
    entityId: release.id,
    before: null,
    after: { ...release, source: "seed-script" },
    requestId: `seed-${Date.now()}`,
  });
}

/** Un-hides a sample book and gives it a fresh date relative to today. */
async function restoreBook(client: DbClient, id: number, book: SampleBook, today: string): Promise<void> {
  const date = sampleDate(today, book.offsetDays, book.precision);
  await client.query(
    `UPDATE books SET hidden = false, published_date = $2, date_precision = $3, updated_at = now() WHERE id = $1`,
    [id, date, book.precision],
  );
  await emitEvent(client, { type: "release.created", payload: { id, title: book.title, releaseDate: date } });
  await writeAudit(client, {
    actor: SEED_ACTOR,
    action: "release.update",
    entityType: "book",
    entityId: id,
    before: { id, hidden: true },
    after: { id, hidden: false, releaseDate: date, datePrecision: book.precision, source: "seed-script" },
    requestId: `seed-${Date.now()}`,
  });
}

/**
 * Hides every sample book (the same soft delete a curator's DELETE does), with
 * an audit row and a live event each. Imported and hand-added books are untouched.
 */
export async function removeSeed(db: Db): Promise<{ removed: number }> {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query<{ id: string; title: string }>(
      `SELECT id, title FROM books WHERE google_volume_id LIKE $1 AND NOT hidden`,
      [`${SEED_PREFIX}%`],
    );
    for (const r of rows) {
      const id = Number(r.id);
      await client.query(`UPDATE books SET hidden = true, updated_at = now() WHERE id = $1`, [id]);
      await emitEvent(client, { type: "release.hidden", payload: { id } });
      await writeAudit(client, {
        actor: SEED_ACTOR,
        action: "release.hide",
        entityType: "book",
        entityId: id,
        before: { id, title: r.title, hidden: false },
        after: { id, title: r.title, hidden: true },
        requestId: `seed-remove-${Date.now()}`,
      });
    }
    return { removed: rows.length };
  });
}
