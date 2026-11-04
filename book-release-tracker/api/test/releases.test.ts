import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";
import { resetDb, TEST_DATABASE_URL } from "./helpers.js";
import { bearer, createTestIssuer, CURATOR } from "./tokens.js";

// F3: methods, status codes, one error shape, server-side validation.
// F6: every write leaves an audit row whose actor comes from the token.

const db = createDb(TEST_DATABASE_URL);
const sql = new pg.Client({ connectionString: TEST_DATABASE_URL });
let app: ReturnType<typeof createApp>;
let curator: Record<string, string>;

beforeAll(async () => {
  await sql.connect();
  const issuer = await createTestIssuer();
  app = createApp({ db, gitSha: "test", verifyToken: issuer.verifier });
  curator = bearer(await issuer.sign(CURATOR));
});
afterAll(async () => {
  await sql.end();
  await db.end();
});

let volume = 0;
function newRelease(overrides: Record<string, unknown> = {}) {
  volume += 1;
  return {
    googleVolumeId: `vol${volume}`,
    title: `Synthetic Title ${volume}`,
    publishedDate: "2026-11-04",
    authors: ["Ana Synthetic"],
    categories: ["Fiction"],
    ...overrides,
  };
}

async function create(body: Record<string, unknown>) {
  const res = await request(app).post("/api/releases").set(curator).send(body);
  expect(res.status).toBe(201);
  return res.body as { id: number };
}

async function auditRows(entityId: number) {
  const r = await sql.query(
    `SELECT actor_subject, actor_role, action, before, after, request_id
       FROM audit_log WHERE entity_type = 'book' AND entity_id = $1 ORDER BY id`,
    [String(entityId)],
  );
  return r.rows;
}

describe("POST /api/releases", () => {
  beforeAll(resetDb);

  it("201 with a Location header and the normalized release", async () => {
    const res = await request(app)
      .post("/api/releases")
      .set(curator)
      .send(newRelease({ publishedDate: "2026-11", authors: ["B Author", "A Author", "B Author"] }));
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/releases/${res.body.id}`);
    expect(res.body).toMatchObject({
      releaseDate: "2026-11-01",
      datePrecision: "month",
      authors: ["A Author", "B Author"], // sorted, duplicate removed
      thumbnailUrl: null,
    });
  });

  it("writes an audit row with the token's subject, the request id and the new state", async () => {
    const res = await request(app).post("/api/releases").set(curator).send(newRelease());
    const rows = await auditRows(res.body.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_subject: CURATOR.oid,
      actor_role: "Curator",
      action: "release.create",
      before: null,
      request_id: res.headers["x-request-id"],
    });
    expect(rows[0].after).toMatchObject({ id: res.body.id, title: res.body.title });
  });

  it("409 when the Google volume is already in the catalog — and no audit row", async () => {
    const body = newRelease();
    await create(body);
    const before = await sql.query(`SELECT count(*)::int AS n FROM audit_log`);
    const res = await request(app).post("/api/releases").set(curator).send({ ...body, title: "Different title" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "conflict", requestId: res.headers["x-request-id"] });
    const after = await sql.query(`SELECT count(*)::int AS n FROM audit_log`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("400 with one detail per invalid field", async () => {
    const res = await request(app)
      .post("/api/releases")
      .set(curator)
      .send({ googleVolumeId: "has spaces!", title: "  ", publishedDate: "2026-02-30", authors: [] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_failed");
    const paths = res.body.error.details.map((d: { path: string }) => d.path).sort();
    expect(paths).toEqual(["authors", "googleVolumeId", "publishedDate", "title"]);
  });

  it("400 for an unknown field (strict validation)", async () => {
    const res = await request(app).post("/api/releases").set(curator).send(newRelease({ hidden: false }));
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].message).toMatch(/unrecognized key/i);
  });

  it("400 for a non-https thumbnail URL", async () => {
    const res = await request(app)
      .post("/api/releases")
      .set(curator)
      .send(newRelease({ thumbnailUrl: "http://example.com/x.jpg" }));
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("thumbnailUrl");
  });
});

describe("GET /api/releases (public)", () => {
  beforeAll(async () => {
    await resetDb();
    await create(newRelease({ title: "Exact Day Book", publishedDate: "2026-11-04", authors: ["Ana Synthetic"] }));
    await create(newRelease({ title: "Sometime In November", publishedDate: "2026-11", authors: ["Bo Fictional"] }));
    await create(newRelease({ title: "Sometime In 2027", publishedDate: "2027", categories: ["Poetry"] }));
    await create(newRelease({ title: "December Book 100%", publishedDate: "2026-12-01", authors: ["Bo Fictional"] }));
    const hidden = await create(newRelease({ title: "Hidden Book", publishedDate: "2026-11-10" }));
    await request(app).delete(`/api/releases/${hidden.id}`).set(curator).expect(204);
  });

  const titles = (res: request.Response) => res.body.items.map((r: { title: string }) => r.title);

  it("200 without a token, sorted by date with exact dates first, hidden releases excluded", async () => {
    const res = await request(app).get("/api/releases");
    expect(res.status).toBe(200);
    expect(titles(res)).toEqual(["Sometime In November", "Exact Day Book", "December Book 100%", "Sometime In 2027"]);
    // "Sometime In November" starts 2026-11-01, before Exact Day Book's 2026-11-04.
  });

  it("from: a vague date counts while its period overlaps (Nov is still on after Nov 20)", async () => {
    const res = await request(app).get("/api/releases?from=2026-11-20");
    expect(titles(res)).toEqual(["Sometime In November", "December Book 100%", "Sometime In 2027"]);
  });

  it("from + to", async () => {
    const res = await request(app).get("/api/releases?from=2026-11-01&to=2026-11-30");
    expect(titles(res)).toEqual(["Sometime In November", "Exact Day Book"]);
  });

  it("q searches titles case-insensitively, and % is matched literally", async () => {
    expect(titles(await request(app).get("/api/releases?q=sometime"))).toEqual([
      "Sometime In November",
      "Sometime In 2027",
    ]);
    expect(titles(await request(app).get("/api/releases?q=100%25"))).toEqual(["December Book 100%"]);
    expect(titles(await request(app).get("/api/releases?q=%25"))).toEqual(["December Book 100%"]);
  });

  it("author and category filters", async () => {
    expect(titles(await request(app).get("/api/releases?author=bo%20fictional"))).toEqual([
      "Sometime In November",
      "December Book 100%",
    ]);
    expect(titles(await request(app).get("/api/releases?category=Poetry"))).toEqual(["Sometime In 2027"]);
  });

  it("an empty result is 200 with an empty list, not 404", async () => {
    const res = await request(app).get("/api/releases?q=no-such-book");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], nextOffset: null, limit: 50, offset: 0 });
  });

  it("pagination with limit/offset and nextOffset", async () => {
    const first = await request(app).get("/api/releases?limit=3");
    expect(first.body.items).toHaveLength(3);
    expect(first.body.nextOffset).toBe(3);
    const second = await request(app).get("/api/releases?limit=3&offset=3");
    expect(titles(second)).toEqual(["Sometime In 2027"]);
    expect(second.body.nextOffset).toBeNull();
  });

  it.each([
    ["unknown parameter (typo)", "?form=2026-11-01"],
    ["impossible date", "?from=2026-02-30"],
    ["from after to", "?from=2026-12-01&to=2026-11-01"],
    ["limit too large", "?limit=1000"],
    ["limit not a number", "?limit=ten"],
    ["repeated parameter", "?q=a&q=b"],
  ])("400 for %s", async (_label, qs) => {
    const res = await request(app).get(`/api/releases${qs}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_failed");
  });
});

describe("GET /api/releases/:id", () => {
  beforeAll(resetDb);

  it("200 for an existing release", async () => {
    const { id } = await create(newRelease());
    const res = await request(app).get(`/api/releases/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
  });

  it("404 for an id that doesn't exist", async () => {
    const res = await request(app).get("/api/releases/999999");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });

  it("400 for an id that isn't a positive integer", async () => {
    expect((await request(app).get("/api/releases/abc")).status).toBe(400);
    expect((await request(app).get("/api/releases/-1")).status).toBe(400);
  });
});

describe("PATCH /api/releases/:id", () => {
  let id: number;
  beforeEach(async () => {
    await resetDb();
    ({ id } = await create(newRelease({ title: "Old Title", publishedDate: "2027" })));
  });

  it("200 with the updated release; audit row has before and after", async () => {
    const res = await request(app)
      .patch(`/api/releases/${id}`)
      .set(curator)
      .send({ title: "New Title", publishedDate: "2027-03-15", authors: ["New Author"] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      title: "New Title",
      releaseDate: "2027-03-15",
      datePrecision: "day",
      authors: ["New Author"],
    });

    const rows = await auditRows(id);
    expect(rows.map((r) => r.action)).toEqual(["release.create", "release.update"]);
    expect(rows[1].before).toMatchObject({ title: "Old Title", releaseDate: "2027-01-01", datePrecision: "year" });
    expect(rows[1].after).toMatchObject({ title: "New Title", releaseDate: "2027-03-15", datePrecision: "day" });
  });

  it("400 for an empty body", async () => {
    const res = await request(app).patch(`/api/releases/${id}`).set(curator).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].message).toMatch(/at least one field/);
  });

  it("400 for malformed JSON", async () => {
    const res = await request(app)
      .patch(`/api/releases/${id}`)
      .set(curator)
      .set("Content-Type", "application/json")
      .send('{"title": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_json");
  });

  it("404 for a release that doesn't exist (no audit row)", async () => {
    const res = await request(app).patch("/api/releases/999999").set(curator).send({ title: "X" });
    expect(res.status).toBe(404);
    const r = await sql.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'release.update'`);
    expect(r.rows[0].n).toBe(0);
  });
});

describe("DELETE /api/releases/:id (soft hide)", () => {
  beforeAll(resetDb);

  it("204, then the release is gone from the public API but still in the database", async () => {
    const { id } = await create(newRelease());
    const del = await request(app).delete(`/api/releases/${id}`).set(curator);
    expect(del.status).toBe(204);
    expect(del.text).toBe("");

    expect((await request(app).get(`/api/releases/${id}`)).status).toBe(404);
    const row = await sql.query(`SELECT hidden FROM books WHERE id = $1`, [id]);
    expect(row.rows[0]).toEqual({ hidden: true });

    const audit = await auditRows(id);
    expect(audit.at(-1)).toMatchObject({ action: "release.hide", after: expect.objectContaining({ hidden: true }) });
  });

  it("404 when deleting it a second time", async () => {
    const { id } = await create(newRelease());
    await request(app).delete(`/api/releases/${id}`).set(curator).expect(204);
    expect((await request(app).delete(`/api/releases/${id}`).set(curator)).status).toBe(404);
  });
});
