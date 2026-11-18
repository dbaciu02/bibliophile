import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { rejectAllVerifier } from "../src/auth.js";
import { createDb } from "../src/db.js";
import { isUpcoming } from "../src/lib/releaseDate.js";
import { SAMPLE_BOOKS, sampleDate } from "../src/seed/sampleBooks.js";
import { removeSeed, seedCatalog } from "../src/seed/seed.js";
import { resetDb, TEST_DATABASE_URL } from "./helpers.js";
import { bearer, createTestIssuer, CURATOR } from "./tokens.js";

const db = createDb(TEST_DATABASE_URL);
const sql = new pg.Client({ connectionString: TEST_DATABASE_URL });
beforeAll(() => sql.connect());
afterAll(async () => {
  await sql.end();
  await db.end();
});

const TODAY = "2026-11-17";

describe("sampleDate (dates relative to today)", () => {
  it.each([
    [6, "day", "2026-11-23"],
    [20, "day", "2026-12-07"], // crosses into December
    [-10, "day", "2026-11-07"], // already out
    [55, "month", "2027-01-01"], // Jan 11 2027 -> "January 2027"
    [400, "year", "2027-01-01"], // Dec 22 2027 -> "sometime in 2027"
  ] as const)("today + %i (%s) -> %s", (offset, precision, expected) => {
    expect(sampleDate(TODAY, offset, precision)).toBe(expected);
  });

  it("there are 160 sample books, from dozens of authors", () => {
    expect(SAMPLE_BOOKS).toHaveLength(160);
    expect(new Set(SAMPLE_BOOKS.flatMap((b) => b.authors)).size).toBeGreaterThan(40);
  });

  it("every sample book has a unique key and title", () => {
    expect(new Set(SAMPLE_BOOKS.map((b) => b.key)).size).toBe(SAMPLE_BOOKS.length);
    expect(new Set(SAMPLE_BOOKS.map((b) => b.title)).size).toBe(SAMPLE_BOOKS.length);
  });
});

describe("seedCatalog / removeSeed", () => {
  beforeEach(resetDb);

  it("adds every sample book once; running it again adds nothing", async () => {
    expect(await seedCatalog(db, TODAY)).toEqual({ added: SAMPLE_BOOKS.length, restored: 0, skipped: 0 });
    expect(await seedCatalog(db, TODAY)).toEqual({ added: 0, restored: 0, skipped: SAMPLE_BOOKS.length });
    const r = await sql.query(`SELECT count(*)::int AS n FROM books`);
    expect(r.rows[0].n).toBe(SAMPLE_BOOKS.length);
  });

  it("sample books show up through the public API, mixed with others, past ones only with past=1", async () => {
    await seedCatalog(db, TODAY);
    const app = createApp({ db, gitSha: "t", verifyToken: rejectAllVerifier });
    // more than one page now: follow nextOffset like the page's "Later →" button
    async function countAll(qs: string): Promise<number> {
      let offset: number | null = 0;
      let n = 0;
      while (offset !== null) {
        const res = await request(app).get(`/api/releases?${qs}&limit=100&offset=${offset}`);
        n += res.body.items.length;
        offset = res.body.nextOffset;
      }
      return n;
    }
    // "Upcoming" uses the core rule: a release counts until its whole period
    // has passed, so a month-only book from earlier this month still counts.
    const upcoming = SAMPLE_BOOKS.filter((b) =>
      isUpcoming({ date: sampleDate(TODAY, b.offsetDays, b.precision), precision: b.precision }, TODAY),
    ).length;
    expect(upcoming).toBeLessThan(SAMPLE_BOOKS.length); // some really are past
    expect(await countAll(`from=${TODAY}`)).toBe(upcoming);
    expect(await countAll("")).toBe(SAMPLE_BOOKS.length);
    // an author with several sample books is found by surname
    const solano = await request(app).get(`/api/releases?author=solano&limit=100`);
    expect(solano.body.items.length).toBeGreaterThanOrEqual(3);
  });

  it("each sample book has an audit row by system:seed-script and a live event", async () => {
    await seedCatalog(db, TODAY);
    const audit = await sql.query(`SELECT DISTINCT actor_subject, action FROM audit_log`);
    expect(audit.rows).toEqual([{ actor_subject: "system:seed-script", action: "release.create" }]);
    const events = await sql.query(`SELECT count(*)::int AS n FROM events WHERE type = 'release.created'`);
    expect(events.rows[0].n).toBe(SAMPLE_BOOKS.length);
  });

  it("remove hides only sample books; imported / hand-added books stay", async () => {
    const issuer = await createTestIssuer();
    const app = createApp({ db, gitSha: "t", verifyToken: issuer.verifier });
    await request(app)
      .post("/api/releases")
      .set(bearer(await issuer.sign(CURATOR)))
      .send({ googleVolumeId: "realVol1", title: "Curator Added", publishedDate: "2027", authors: ["Someone"] })
      .expect(201);
    await seedCatalog(db, TODAY);

    expect(await removeSeed(db)).toEqual({ removed: SAMPLE_BOOKS.length });
    const visible = await sql.query(`SELECT title FROM books WHERE NOT hidden`);
    expect(visible.rows).toEqual([{ title: "Curator Added" }]);
    expect(await removeSeed(db)).toEqual({ removed: 0 });
  });

  it("seeding after a remove brings them back with dates computed from the NEW today", async () => {
    await seedCatalog(db, TODAY);
    await removeSeed(db);
    const later = "2027-06-01";
    expect(await seedCatalog(db, later)).toEqual({ added: 0, restored: SAMPLE_BOOKS.length, skipped: 0 });
    const lantern = await sql.query(`SELECT published_date, hidden FROM books WHERE google_volume_id = 'seed-lantern-keeper'`);
    expect(lantern.rows[0]).toEqual({ published_date: sampleDate(later, 6, "day"), hidden: false });
  });
});
