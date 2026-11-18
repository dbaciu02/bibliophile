import { createDb } from "../db.js";
import { removeSeed, seedCatalog } from "../seed/seed.js";
import { SAMPLE_BOOKS } from "../seed/sampleBooks.js";

/**
 * npm run seed          add the invented sample books (safe to run again)
 * npm run seed:remove   hide them again (imported / hand-added books untouched)
 *
 * Uses DATABASE_URL from api/.env. Refuses to touch a production database
 * unless ALLOW_SEED=1 is set on purpose (e.g. for a demo).
 */
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (copy .env.example to api/.env)");
  process.exit(1);
}
if (process.env.NODE_ENV === "production" && process.env.ALLOW_SEED !== "1") {
  console.error("Refusing to seed a production database. Set ALLOW_SEED=1 if you really mean it.");
  process.exit(1);
}

const db = createDb(url);
try {
  if (process.argv.includes("--remove")) {
    const { removed } = await removeSeed(db);
    console.log(`Hid ${removed} sample book(s).`);
  } else {
    const today = new Date().toISOString().slice(0, 10);
    const { added, restored, skipped } = await seedCatalog(db, today);
    console.log(
      `Sample books: ${added} added, ${restored} restored, ${skipped} already there (${SAMPLE_BOOKS.length} in the sample set).`,
    );
  }
} finally {
  await db.end();
}
