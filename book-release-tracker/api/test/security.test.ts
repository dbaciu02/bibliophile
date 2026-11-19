/**
 * D7 (CORS allowlist, security headers) and S1 (write-route rate limits).
 */
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";
import { parseOrigins } from "../src/security.js";
import { resetDb, TEST_DATABASE_URL } from "./helpers.js";
import { bearer, createTestIssuer, READER, type TestIssuer } from "./tokens.js";

const SITE = "https://bibliophile.example.test";
const db = createDb(TEST_DATABASE_URL);
let issuer: TestIssuer;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  await resetDb();
  issuer = await createTestIssuer();
  app = createApp({ db, gitSha: "test", verifyToken: issuer.verifier, corsOrigins: [SITE] });
});
afterAll(async () => {
  await db.end();
});

describe("CORS allowlist (exact origins)", () => {
  it("allowed origin: the response names it, and says it varies by Origin", async () => {
    const res = await request(app).get("/api/releases").set("Origin", SITE);
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(SITE);
    expect(res.headers["vary"]).toMatch(/Origin/);
    expect(res.headers["access-control-expose-headers"]).toContain("X-Request-Id");
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("other origins get no CORS headers (the browser then blocks the page from reading)", async () => {
    for (const origin of [
      "https://evil.example",
      "http://bibliophile.example.test", // http instead of https
      "https://bibliophile.example.test:8443", // different port
      "https://bibliophile.example.test.evil.example", // suffix trick
      "https://staging.bibliophile.example.test", // sibling subdomain
      "null",
    ]) {
      const res = await request(app).get("/api/releases").set("Origin", origin);
      expect(res.headers["access-control-allow-origin"], origin).toBeUndefined();
    }
  });

  it("preflight from the allowed origin -> 204 with the methods and headers the site uses", async () => {
    const res = await request(app)
      .options("/api/me/watchlist")
      .set("Origin", SITE)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "authorization, content-type");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(SITE);
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
    expect(res.headers["access-control-allow-headers"]).toMatch(/Authorization/);
    expect(res.headers["access-control-max-age"]).toBe("600");
  });

  it("preflight from another origin -> 403 in the standard error shape, no CORS headers", async () => {
    const res = await request(app)
      .options("/api/me/watchlist")
      .set("Origin", "https://evil.example")
      .set("Access-Control-Request-Method", "DELETE");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("forbidden");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("no Origin header (curl, servers): served normally", async () => {
    const res = await request(app).get("/api/releases");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("CORS_ORIGINS must be exact origins", () => {
    expect(parseOrigins(" https://a.example , https://b.example:8443 ")).toEqual(["https://a.example", "https://b.example:8443"]);
    expect(parseOrigins("")).toEqual([]);
    expect(() => parseOrigins("https://a.example/")).toThrow(/exact origin/);
    expect(() => parseOrigins("https://a.example/app")).toThrow(/exact origin/);
    expect(() => parseOrigins("*")).toThrow(/not a URL/);
  });
});

describe("security headers", () => {
  it("are on every response, including errors", async () => {
    for (const path of ["/healthz", "/api/releases", "/api/nope", "/api/me"]) {
      const res = await request(app).get(path);
      expect(res.headers["strict-transport-security"], path).toBe("max-age=31536000; includeSubDomains");
      expect(res.headers["x-content-type-options"], path).toBe("nosniff");
      expect(res.headers["referrer-policy"], path).toBe("no-referrer");
      expect(res.headers["content-security-policy"], path).toContain("default-src 'none'");
      expect(res.headers["x-frame-options"], path).toBe("DENY");
      expect(res.headers["x-powered-by"], path).toBeUndefined();
    }
  });
});

describe("write rate limits (S1)", () => {
  it("watchlist writes: the 31st in a minute -> 429 with Retry-After", async () => {
    const auth = bearer(await issuer.sign(READER));
    const statuses: number[] = [];
    for (let i = 1; i <= 31; i++) {
      const res = await request(app).post("/api/me/watchlist").set(auth).send({ authorName: `Limit Author ${i}` });
      statuses.push(res.status);
      if (i === 31) {
        expect(res.status).toBe(429);
        expect(res.body.error.code).toBe("rate_limited");
        expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
      }
    }
    expect(statuses.slice(0, 30).every((s) => s === 201)).toBe(true);
  });
});
