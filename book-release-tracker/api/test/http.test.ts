import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { rejectAllVerifier } from "../src/auth.js";
import { createDb } from "../src/db.js";
import { TEST_DATABASE_URL } from "./helpers.js";

const db = createDb(TEST_DATABASE_URL);
// Port 1 on localhost: nothing listens there, so every connection is refused.
const deadDb = createDb("postgres://app:app@127.0.0.1:1/nothing");

const app = createApp({ db, gitSha: "abc1234", verifyToken: rejectAllVerifier });
const appWithDeadDb = createApp({ db: deadDb, gitSha: "abc1234", verifyToken: rejectAllVerifier });

afterAll(async () => {
  await db.end();
  await deadDb.end();
});

const UUID = /^[0-9a-f-]{36}$/;

describe("GET /healthz", () => {
  it("returns 200 with the commit SHA when the database is reachable", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", db: "ok", commit: "abc1234" });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("returns 503 when the database is down (so CI won't promote the deploy)", async () => {
    const res = await request(appWithDeadDb).get("/healthz");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: "unavailable", db: "unreachable" });
  });
});

describe("error shape", () => {
  it("unknown route -> 404 in the standard shape, with a request id that matches the header", async () => {
    const res = await request(app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: "not_found",
        message: "No route for GET /api/does-not-exist",
        requestId: res.headers["x-request-id"],
      },
    });
    expect(res.headers["x-request-id"]).toMatch(UUID);
  });

  it("malformed JSON body -> 400 invalid_json", async () => {
    const res = await request(app)
      .post("/api/anything")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_json");
    expect(res.body.error.requestId).toBe(res.headers["x-request-id"]);
  });

  it("reuses a safe incoming X-Request-Id", async () => {
    const res = await request(app).get("/nope").set("X-Request-Id", "cdn-req-12345678");
    expect(res.headers["x-request-id"]).toBe("cdn-req-12345678");
    expect(res.body.error.requestId).toBe("cdn-req-12345678");
  });

  it("replaces an unsafe incoming X-Request-Id instead of logging it", async () => {
    const res = await request(app).get("/nope").set("X-Request-Id", "bad id <script>");
    expect(res.headers["x-request-id"]).toMatch(UUID);
  });

  it("does not advertise Express", async () => {
    const res = await request(app).get("/healthz");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});
