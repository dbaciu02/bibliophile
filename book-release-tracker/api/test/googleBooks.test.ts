import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";
import { createBooksService } from "../src/googleBooks/cachedBooks.js";
import { createGoogleBooksClient, GoogleBooksError, type GoogleBooksOptions } from "../src/googleBooks/client.js";
import { httpsThumbnail, toCandidate } from "../src/googleBooks/mapping.js";
import { noSleep, searchResult, stubGoogle, volume, type Behaviour } from "./googleStub.js";
import { resetDb, TEST_DATABASE_URL } from "./helpers.js";
import { bearer, createTestIssuer, CURATOR, READER } from "./tokens.js";

// Q1 third-party test / F10 evidence. Google is ALWAYS stubbed here: no network,
// no API key. Hand-predict the call counts before running (docs/evidence/hand-predictions.md).

function client(script: Behaviour[], extra: GoogleBooksOptions = {}) {
  const stub = stubGoogle(...script);
  const c = createGoogleBooksClient({ fetch: stub.fetch, sleep: noSleep, apiKey: "test-key-not-real-0000", ...extra });
  return { c, stub };
}

async function failure(p: Promise<unknown>): Promise<GoogleBooksError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof GoogleBooksError) return err;
    throw err;
  }
  throw new Error("expected the call to fail");
}

// ---------------------------------------------------------------- the client
describe("Google Books client — timeout, bounded retry, validation (F10)", () => {
  it("success on the first try: exactly 1 call, key sent in the X-Goog-Api-Key header, never in the URL", async () => {
    const { c, stub } = client([{ ok: searchResult(volume("v1")) }]);
    const r = await c.search("dune", 5);
    expect(r.items?.[0]?.id).toBe("v1");
    expect(stub.calls).toHaveLength(1);
    const url = new URL(stub.calls[0] as string);
    expect(url.pathname).toBe("/books/v1/volumes");
    expect(url.searchParams.get("q")).toBe("dune");
    expect(url.searchParams.has("key")).toBe(false);
    expect(stub.calls[0]).not.toContain("test-key-not-real-0000");
    expect(stub.headers[0]?.["X-Goog-Api-Key"]).toBe("test-key-not-real-0000");
  });

  it("503, 503, then 200: retries twice and succeeds — 3 calls", async () => {
    const { c, stub } = client([{ status: 503 }, { status: 503 }, { ok: searchResult() }]);
    await c.search("dune", 5);
    expect(stub.calls).toHaveLength(3);
  });

  it("always 503: gives up after 1 try + 2 retries — 3 calls, never more (bounded)", async () => {
    const { c, stub } = client([{ status: 503 }]);
    const err = await failure(c.search("dune", 5));
    expect(err.kind).toBe("unavailable");
    expect(err.attempts).toBe(3);
    expect(stub.calls).toHaveLength(3);
  });

  it("timeout: a hung connection is aborted after timeoutMs, and the timeouts are retried too", async () => {
    const { c, stub } = client([{ hang: true }], { timeoutMs: 30 });
    const started = Date.now();
    const err = await failure(c.search("dune", 5));
    expect(err.kind).toBe("unavailable");
    expect(err.message).toContain("timed out after 30 ms");
    expect(stub.calls).toHaveLength(3);
    expect(Date.now() - started).toBeLessThan(2_000); // 3 × 30 ms, not forever
  });

  it("network error is retried like a 5xx", async () => {
    const { c, stub } = client([{ networkError: true }, { ok: searchResult() }]);
    await c.search("dune", 5);
    expect(stub.calls).toHaveLength(2);
  });

  it("429 honours Retry-After (capped), then retries", async () => {
    const waits: number[] = [];
    const { c, stub } = client([{ status: 429, retryAfter: 60 }, { ok: searchResult() }], {
      sleep: async (ms) => void waits.push(ms),
      maxRetryAfterMs: 2_000,
    });
    await c.search("dune", 5);
    expect(stub.calls).toHaveLength(2);
    expect(waits).toEqual([2_000]); // Google asked for 60 s; we never wait longer than the cap
  });

  it.each([400, 403])("%i is NOT retried (retrying a bad request can't help) — 1 call", async (status) => {
    const { c, stub } = client([{ status }]);
    const err = await failure(c.search("dune", 5));
    expect(err.kind).toBe("bad_request");
    expect(stub.calls).toHaveLength(1);
  });

  it("404 on a volume -> not_found, 1 call", async () => {
    const { c, stub } = client([{ status: 404 }]);
    expect((await failure(c.getVolume("nope"))).kind).toBe("not_found");
    expect(stub.calls).toHaveLength(1);
  });

  it("runtime validation: a 200 with the wrong shape is rejected, not passed on", async () => {
    const { c } = client([{ ok: { totalItems: "lots", items: [{ id: "x" }] } }]);
    expect((await failure(c.search("dune", 5))).kind).toBe("invalid_response");
  });

  it("runtime validation: a 200 that isn't JSON is rejected", async () => {
    const { c } = client([{ notJson: true }]);
    expect((await failure(c.search("dune", 5))).kind).toBe("invalid_response");
  });

  it("no results: Google omits `items`; that's valid", async () => {
    const { c } = client([{ ok: { kind: "books#volumes", totalItems: 0 } }]);
    expect(await c.search("zzzz", 5)).toEqual({ totalItems: 0 });
  });

  it("circuit breaker: after 3 failed calls it stops calling Google for the cooldown, then tries again", async () => {
    let t = 1_000_000;
    const { c, stub } = client([{ status: 503 }], { maxRetries: 0, breakerThreshold: 3, breakerCooldownMs: 30_000, now: () => t });
    for (let i = 0; i < 3; i++) await failure(c.search("dune", 5));
    expect(stub.calls).toHaveLength(3);
    expect(c.breakerState()).toBe("open");

    const fast = await failure(c.search("dune", 5));
    expect(fast.kind).toBe("circuit_open");
    expect(stub.calls).toHaveLength(3); // no new call while open

    t += 30_001;
    expect(c.breakerState()).toBe("closed");
    await failure(c.search("dune", 5));
    expect(stub.calls).toHaveLength(4); // tries Google again after the cooldown
  });

  it("the API key never appears in an error message", async () => {
    const { c } = client([{ status: 503 }]);
    const err = await failure(c.search("dune", 5));
    expect(err.message).not.toContain("test-key-not-real");
  });
});

describe("mapping Google data to our model", () => {
  it("normalizes the date with the core calculation and upgrades the thumbnail to https", () => {
    expect(toCandidate(volume("abc") as never)).toMatchObject({
      googleVolumeId: "abc",
      publishedDateRaw: "2027-03",
      releaseDate: "2027-03-01",
      datePrecision: "month",
      thumbnailUrl: "https://books.google.com/books/content?id=abc&printsec=frontcover&img=1&zoom=1",
    });
  });

  it("an unusable date becomes null instead of a guess", () => {
    expect(toCandidate(volume("abc", { publishedDate: "2027-02-30" }) as never).releaseDate).toBeNull();
  });

  it("thumbnails from other hosts are dropped", () => {
    expect(httpsThumbnail("http://evil.example.com/x.jpg")).toBeNull();
  });
});

// ---------------------------------------------------------------- the cache
const db = createDb(TEST_DATABASE_URL);
const sql = new pg.Client({ connectionString: TEST_DATABASE_URL });
beforeAll(() => sql.connect());
afterAll(async () => {
  await sql.end();
  await db.end();
});

async function expireCache() {
  await sql.query(`UPDATE google_books_cache SET expires_at = now() - interval '1 second'`);
}

describe("cache in front of Google (F10: respects the quota, degrades gracefully)", () => {
  beforeEach(resetDb);

  it("second identical search within the TTL is served from cache — Google called once", async () => {
    const { c, stub } = client([{ ok: searchResult(volume("v1")) }]);
    const books = createBooksService(db, c);
    expect((await books.search("Dune", 5)).source).toBe("live");
    expect((await books.search("  dune ", 5)).source).toBe("cache"); // same query after trim/lowercase
    expect(stub.calls).toHaveLength(1);
  });

  it("after the TTL expires, Google is asked again", async () => {
    const { c, stub } = client([{ ok: searchResult(volume("v1")) }]);
    const books = createBooksService(db, c);
    await books.search("dune", 5);
    await expireCache();
    expect((await books.search("dune", 5)).source).toBe("live");
    expect(stub.calls).toHaveLength(2);
  });

  it("Google DOWN + expired cache -> the old answer is served, marked stale (graceful degradation)", async () => {
    const { c, stub } = client([{ ok: searchResult(volume("v1")) }, { status: 503 }]);
    const books = createBooksService(db, c);
    const first = await books.search("dune", 5);
    await expireCache();

    const second = await books.search("dune", 5);
    expect(second.source).toBe("stale");
    expect(second.data.items?.[0]?.id).toBe("v1");
    expect(second.fetchedAt).toBe(first.fetchedAt); // tells the user how old it is
    expect(stub.calls).toHaveLength(1 + 3); // one success, then 1 try + 2 retries
  });

  it("Google DOWN + nothing cached -> the error is passed up (becomes a 503)", async () => {
    const { c } = client([{ status: 503 }]);
    const books = createBooksService(db, c);
    await expect(books.search("never searched", 5)).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("a 404 is NOT papered over with stale data", async () => {
    const { c } = client([{ ok: volume("v1") }, { status: 404 }]);
    const books = createBooksService(db, c);
    await books.getVolume("v1");
    await expireCache();
    await expect(books.getVolume("v1")).rejects.toMatchObject({ kind: "not_found" });
  });
});

// ---------------------------------------------------------------- the routes
describe("GET /api/books/search and POST /api/releases/import", () => {
  let issuer: Awaited<ReturnType<typeof createTestIssuer>>;
  let curator: Record<string, string>;
  let reader: Record<string, string>;

  beforeAll(async () => {
    issuer = await createTestIssuer();
    curator = bearer(await issuer.sign(CURATOR));
    reader = bearer(await issuer.sign(READER));
  });
  beforeEach(resetDb);

  function appWith(...script: Behaviour[]) {
    const { c, stub } = client(script);
    const app = createApp({ db, gitSha: "test", verifyToken: issuer.verifier, books: createBooksService(db, c) });
    return { app, stub };
  }

  it("search: 200 with normalized candidates, source and inCatalog", async () => {
    const { app } = appWith({ ok: searchResult(volume("v1"), volume("v2", { publishedDate: undefined })) });
    const res = await request(app).get("/api/books/search?q=synthetic").set(curator);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.body.source).toBe("live");
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toMatchObject({ googleVolumeId: "v1", releaseDate: "2027-03-01", inCatalog: false });
    expect(res.body.items[1]).toMatchObject({ googleVolumeId: "v2", releaseDate: null });
  });

  it("search: Reader -> 403, anonymous -> 401 (only curators spend quota)", async () => {
    const { app, stub } = appWith({ ok: searchResult() });
    expect((await request(app).get("/api/books/search?q=dune").set(reader)).status).toBe(403);
    expect((await request(app).get("/api/books/search?q=dune")).status).toBe(401);
    expect(stub.calls).toHaveLength(0);
  });

  it("search: 400 for a too-short query, without calling Google", async () => {
    const { app, stub } = appWith({ ok: searchResult() });
    const res = await request(app).get("/api/books/search?q=a").set(curator);
    expect(res.status).toBe(400);
    expect(stub.calls).toHaveLength(0);
  });

  it("search with Google DOWN and nothing cached -> 503 in the standard error shape", async () => {
    const { app } = appWith({ status: 503 });
    const res = await request(app).get("/api/books/search?q=dune").set(curator);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ code: "upstream_unavailable", requestId: res.headers["x-request-id"] });
  });

  it("search is rate limited: the 31st request in a minute -> 429 with Retry-After (S1)", async () => {
    const { app } = appWith({ ok: searchResult() });
    for (let i = 0; i < 30; i++) {
      expect((await request(app).get("/api/books/search?q=dune").set(curator)).status).toBe(200);
    }
    const res = await request(app).get("/api/books/search?q=dune").set(curator);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("rate_limited");
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("import: 201 + Location, release built from Google data, audited as release.import", async () => {
    const { app } = appWith({ ok: volume("imp1", { authors: ["B Author", "A Author"] }) });
    const res = await request(app).post("/api/releases/import").set(curator).send({ googleVolumeId: "imp1" });
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/releases/${res.body.id}`);
    expect(res.body).toMatchObject({
      googleVolumeId: "imp1",
      releaseDate: "2027-03-01",
      datePrecision: "month",
      authors: ["A Author", "B Author"],
      importSource: "live",
    });
    expect(res.body.thumbnailUrl).toMatch(/^https:\/\//);

    const audit = await sql.query(`SELECT actor_subject, action, after FROM audit_log WHERE entity_id = $1`, [String(res.body.id)]);
    expect(audit.rows[0]).toMatchObject({ actor_subject: CURATOR.oid, action: "release.import" });
    expect(audit.rows[0].after.importedFrom).toMatchObject({ provider: "google_books", source: "live" });
  });

  it("import the same volume twice -> 409, and the second time Google isn't even called", async () => {
    const { app, stub } = appWith({ ok: volume("imp1") });
    await request(app).post("/api/releases/import").set(curator).send({ googleVolumeId: "imp1" }).expect(201);
    const res = await request(app).post("/api/releases/import").set(curator).send({ googleVolumeId: "imp1" });
    expect(res.status).toBe(409);
    expect(stub.calls).toHaveLength(1);
  });

  it("import a volume with no usable date -> 400 explaining why", async () => {
    const { app } = appWith({ ok: volume("nodate", { publishedDate: undefined }) });
    const res = await request(app).post("/api/releases/import").set(curator).send({ googleVolumeId: "nodate" });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("publishedDate");
  });

  it("import a volume Google doesn't have -> 404", async () => {
    const { app } = appWith({ status: 404 });
    const res = await request(app).post("/api/releases/import").set(curator).send({ googleVolumeId: "missing1" });
    expect(res.status).toBe(404);
  });

  it("import with Google DOWN and nothing cached -> 503, and nothing is written", async () => {
    const { app } = appWith({ status: 503 });
    const res = await request(app).post("/api/releases/import").set(curator).send({ googleVolumeId: "down1" });
    expect(res.status).toBe(503);
    const counts = await sql.query(`SELECT (SELECT count(*) FROM books)::int AS books, (SELECT count(*) FROM audit_log)::int AS audit`);
    expect(counts.rows[0]).toEqual({ books: 0, audit: 0 });
  });

  it("import as Reader -> 403", async () => {
    const { app } = appWith({ ok: volume("imp1") });
    expect((await request(app).post("/api/releases/import").set(reader).send({ googleVolumeId: "imp1" })).status).toBe(403);
  });
});

// ------------------------------------------------- search fields and date filters
describe("GET /api/books/search — field search, sort and date filters", () => {
  let issuer: Awaited<ReturnType<typeof createTestIssuer>>;
  let curator: Record<string, string>;
  beforeAll(async () => {
    issuer = await createTestIssuer();
    curator = bearer(await issuer.sign(CURATOR));
  });
  beforeEach(resetDb);

  function appWith(...script: Behaviour[]) {
    const { c, stub } = client(script);
    const app = createApp({ db, gitSha: "test", verifyToken: issuer.verifier, books: createBooksService(db, c) });
    return { app, stub };
  }
  const sentQuery = (url: string | undefined) => new URL(url ?? "").searchParams;

  it("builds Google's field syntax from the separate inputs, and passes the sort order", async () => {
    const { app, stub } = appWith({ ok: searchResult() });
    const res = await request(app)
      .get("/api/books/search")
      .query({ title: "dune", author: 'Frank "the" Herbert', subject: "Science Fiction", orderBy: "newest" })
      .set(curator);
    expect(res.status).toBe(200);
    expect(res.body.googleQuery).toBe('intitle:"dune" inauthor:"Frank the Herbert" subject:"Science Fiction"');
    const sent = sentQuery(stub.calls[0]);
    expect(sent.get("q")).toBe(res.body.googleQuery); // quotes typed by the user are stripped
    expect(sent.get("orderBy")).toBe("newest");
  });

  it("ISBN with hyphens is accepted and sent as digits", async () => {
    const { app, stub } = appWith({ ok: searchResult() });
    await request(app).get("/api/books/search").query({ isbn: "978-0-441-01359-3" }).set(curator).expect(200);
    expect(sentQuery(stub.calls[0]).get("q")).toBe("isbn:9780441013593");
  });

  it.each([
    ["no search field at all", {}],
    ["only a year (Google can't search by date alone)", { year: "2027" }],
    ["a bad ISBN", { isbn: "12345" }],
    ["maxResults over Google's limit", { q: "dune", maxResults: "41" }],
    ["an unknown sort", { q: "dune", orderBy: "oldest" }],
  ])("400 for %s, without calling Google", async (_label, query) => {
    const { app, stub } = appWith({ ok: searchResult() });
    const res = await request(app).get("/api/books/search").query(query).set(curator);
    expect(res.status).toBe(400);
    expect(stub.calls).toHaveLength(0);
  });

  it("year filter keeps only that year (any precision), drops undated books, and reports how many it hid", async () => {
    const { app } = appWith({
      ok: searchResult(
        volume("y1", { publishedDate: "2027-03-01" }),
        volume("y2", { publishedDate: "2027" }),
        volume("y3", { publishedDate: "2026-12-31" }),
        volume("y4", { publishedDate: undefined }),
      ),
    });
    const res = await request(app).get("/api/books/search").query({ q: "synthetic", year: "2027" }).set(curator);
    expect(res.body.items.map((i: { googleVolumeId: string }) => i.googleVolumeId)).toEqual(["y1", "y2"]);
    expect(res.body.hiddenByDateFilter).toBe(2);
  });

  it("upcomingOnly keeps books whose release period hasn't ended yet", async () => {
    const { app } = appWith({
      ok: searchResult(
        volume("u1", { publishedDate: "2099-01-01" }),
        volume("u2", { publishedDate: "2001-05" }),
        volume("u3", { publishedDate: undefined }),
      ),
    });
    const res = await request(app).get("/api/books/search").query({ author: "Ana", upcomingOnly: "true" }).set(curator);
    expect(res.body.items.map((i: { googleVolumeId: string }) => i.googleVolumeId)).toEqual(["u1"]);
    expect(res.body.hiddenByDateFilter).toBe(2);
  });

  it("the date filters don't change what's cached: same Google query, different year -> one Google call", async () => {
    const { app, stub } = appWith({ ok: searchResult(volume("c1", { publishedDate: "2027" })) });
    await request(app).get("/api/books/search").query({ q: "dune", year: "2027" }).set(curator).expect(200);
    const res = await request(app).get("/api/books/search").query({ q: "dune", year: "2028" }).set(curator);
    expect(res.body.source).toBe("cache");
    expect(res.body.items).toEqual([]);
    expect(stub.calls).toHaveLength(1);
  });
});
