import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";
import { resetDb, TEST_DATABASE_URL } from "./helpers.js";
import { bearer, createTestIssuer, CURATOR, READER, READER_2 } from "./tokens.js";

const db = createDb(TEST_DATABASE_URL);
const sql = new pg.Client({ connectionString: TEST_DATABASE_URL });
let app: ReturnType<typeof createApp>;
let reader: Record<string, string>;
let reader2: Record<string, string>;
let curator: Record<string, string>;

beforeAll(async () => {
  await resetDb();
  await sql.connect();
  const issuer = await createTestIssuer();
  app = createApp({ db, gitSha: "test", verifyToken: issuer.verifier });
  reader = bearer(await issuer.sign(READER));
  reader2 = bearer(await issuer.sign(READER_2));
  curator = bearer(await issuer.sign(CURATOR));

  // Catalog: one past and one far-future release by the same synthetic author.
  for (const [vol, date] of [["wl1", "2020-05-01"], ["wl2", "2099-01"]] as const) {
    await request(app)
      .post("/api/releases")
      .set(curator)
      .send({ googleVolumeId: vol, title: `Book ${vol}`, publishedDate: date, authors: ["Watched Author"] })
      .expect(201);
  }
});
afterAll(async () => {
  await sql.end();
  await db.end();
});

describe("/api/me/watchlist", () => {
  let itemId: number;

  it("starts empty (200, private and never cached)", async () => {
    const res = await request(app).get("/api/me/watchlist").set(reader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
    expect(res.headers["cache-control"]).toBe("private, no-store");
  });

  it("POST -> 201 with Location; upcomingCount counts only releases not yet out", async () => {
    const res = await request(app).post("/api/me/watchlist").set(reader).send({ authorName: "Watched Author" });
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/me/watchlist/${res.body.id}`);
    expect(res.body).toMatchObject({ author: "Watched Author", upcomingCount: 1 });
    itemId = res.body.id;
  });

  it("POST the same author again -> 409", async () => {
    const res = await request(app).post("/api/me/watchlist").set(reader).send({ authorName: "Watched Author" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("conflict");
  });

  it("following an author with no releases yet is allowed (upcomingCount 0)", async () => {
    const res = await request(app).post("/api/me/watchlist").set(reader).send({ authorName: "Debut Author" });
    expect(res.status).toBe(201);
    expect(res.body.upcomingCount).toBe(0);
  });

  it("400 for a blank author name", async () => {
    const res = await request(app).post("/api/me/watchlist").set(reader).send({ authorName: "   " });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("authorName");
  });

  it("each user only sees their own list", async () => {
    const mine = await request(app).get("/api/me/watchlist").set(reader);
    expect(mine.body.items.map((i: { author: string }) => i.author)).toEqual(["Debut Author", "Watched Author"]);
    const theirs = await request(app).get("/api/me/watchlist").set(reader2);
    expect(theirs.body.items).toEqual([]);
  });

  it("another user deleting my item -> 404 (not 403: don't reveal it exists)", async () => {
    const res = await request(app).delete(`/api/me/watchlist/${itemId}`).set(reader2);
    expect(res.status).toBe(404);
  });

  it("DELETE my item -> 204, then 404 the second time", async () => {
    expect((await request(app).delete(`/api/me/watchlist/${itemId}`).set(reader)).status).toBe(204);
    expect((await request(app).delete(`/api/me/watchlist/${itemId}`).set(reader)).status).toBe(404);
  });

  it("audit trail records add and remove with the reader's subject", async () => {
    const r = await sql.query(
      `SELECT action, actor_subject, before IS NULL AS no_before, after IS NULL AS no_after
         FROM audit_log WHERE entity_type = 'watchlist_item' AND entity_id = $1 ORDER BY id`,
      [String(itemId)],
    );
    expect(r.rows).toEqual([
      { action: "watchlist.add", actor_subject: READER.oid, no_before: true, no_after: false },
      { action: "watchlist.remove", actor_subject: READER.oid, no_before: false, no_after: true },
    ]);
  });

  it("creates exactly one users row per token subject", async () => {
    const r = await sql.query(`SELECT idp_subject FROM users ORDER BY idp_subject`);
    expect(r.rows.map((u) => u.idp_subject)).toEqual([READER.oid, READER_2.oid]);
  });
});
