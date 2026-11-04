import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";
import { resetDb, TEST_DATABASE_URL } from "./helpers.js";
import { bearer, createTestIssuer, CURATOR, READER, type TestIssuer } from "./tokens.js";

// F8: one failing test per token check (signature, issuer, audience, expiry, scope).
// F9: 401 for anonymous, 403 for a Reader attempting a Curator write.

const db = createDb(TEST_DATABASE_URL);
let issuer: TestIssuer;
let app: ReturnType<typeof createApp>;

const PROTECTED = "/api/me/watchlist"; // any authenticated user with Watchlist.ReadWrite

beforeAll(async () => {
  await resetDb();
  issuer = await createTestIssuer();
  app = createApp({ db, gitSha: "test", verifyToken: issuer.verifier });
});
afterAll(() => db.end());

function expect401(res: request.Response) {
  expect(res.status).toBe(401);
  expect(res.body.error.code).toBe("unauthenticated");
  expect(res.headers["www-authenticate"]).toMatch(/^Bearer /);
}

describe("a valid token is accepted", () => {
  it("200 with a correctly signed, unexpired token for the right issuer and audience", async () => {
    const res = await request(app).get(PROTECTED).set(bearer(await issuer.sign(READER)));
    expect(res.status).toBe(200);
  });
});

describe("401 — no usable token", () => {
  it("no Authorization header", async () => {
    expect401(await request(app).get(PROTECTED));
  });

  it("not a Bearer token", async () => {
    expect401(await request(app).get(PROTECTED).set("Authorization", "Basic dXNlcjpwYXNz"));
  });

  it("garbage instead of a JWT", async () => {
    expect401(await request(app).get(PROTECTED).set("Authorization", "Bearer not-a-jwt"));
  });
});

describe("401 — one failing test per validation check (F8)", () => {
  it("signature: signed by a key that is not in the JWKS", async () => {
    const token = await issuer.signWithUntrustedKey(READER);
    expect401(await request(app).get(PROTECTED).set(bearer(token)));
  });

  it('signature: unsigned token with alg "none"', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${b64({ alg: "none", typ: "JWT" })}.${b64({ ...READER, iat: now, exp: now + 3600 })}.`;
    expect401(await request(app).get(PROTECTED).set(bearer(unsigned)));
  });

  it("signature: payload changed after signing", async () => {
    const [header, , signature] = (await issuer.sign(READER)).split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ ...READER, roles: ["Curator"] })).toString("base64url");
    expect401(await request(app).get(PROTECTED).set(bearer(`${header}.${forgedPayload}.${signature}`)));
  });

  it("issuer: token from a different tenant", async () => {
    const token = await issuer.sign({
      ...READER,
      iss: "https://login.microsoftonline.com/99999999-9999-9999-9999-999999999999/v2.0",
    });
    expect401(await request(app).get(PROTECTED).set(bearer(token)));
  });

  it("issuer: v1 issuer format (access token version not set to 2)", async () => {
    const token = await issuer.sign({ ...READER, iss: "https://sts.windows.net/00000000-0000-0000-0000-000000000001/" });
    expect401(await request(app).get(PROTECTED).set(bearer(token)));
  });

  it("audience: token issued for a different API", async () => {
    const token = await issuer.sign({ ...READER, aud: "00000000-0000-0000-0000-0000000000ff" });
    expect401(await request(app).get(PROTECTED).set(bearer(token)));
  });

  it("audience: Microsoft Graph token instead of one for this API", async () => {
    const token = await issuer.sign({ ...READER, aud: "https://graph.microsoft.com" });
    expect401(await request(app).get(PROTECTED).set(bearer(token)));
  });

  it("expiry: token expired 1 second ago", async () => {
    const token = await issuer.sign({ ...READER, expiresIn: -1 });
    expect401(await request(app).get(PROTECTED).set(bearer(token)));
  });
});

describe("403 — valid token, not allowed (F8 scope, F9 role)", () => {
  it("scope: token without Watchlist.ReadWrite", async () => {
    const token = await issuer.sign({ ...READER, scp: "Releases.Read" });
    const res = await request(app).get(PROTECTED).set(bearer(token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("forbidden");
    expect(res.headers["www-authenticate"]).toContain('error="insufficient_scope"');
  });

  it("role: token with no recognised role", async () => {
    const token = await issuer.sign({ ...READER, roles: [] });
    expect((await request(app).get(PROTECTED).set(bearer(token))).status).toBe(403);
  });

  it("role: unknown role names are ignored, not trusted", async () => {
    const token = await issuer.sign({ ...READER, roles: ["Admin", "curator"] });
    expect((await request(app).get(PROTECTED).set(bearer(token))).status).toBe(403);
  });
});

describe("F9 proof: anonymous -> 401, Reader -> 403, Curator -> 201 on a catalog write", () => {
  const body = {
    googleVolumeId: "authTestVol1",
    title: "A Synthetic Novel",
    publishedDate: "2026-12",
    authors: ["Synthetic Author"],
  };

  it("anonymous POST /api/releases -> 401", async () => {
    expect401(await request(app).post("/api/releases").send(body));
  });

  it("Reader POST /api/releases -> 403 (has a valid token, lacks the scope)", async () => {
    const res = await request(app).post("/api/releases").set(bearer(await issuer.sign(READER))).send(body);
    expect(res.status).toBe(403);
  });

  it("Reader who somehow has Releases.Write but not the Curator role -> 403", async () => {
    const token = await issuer.sign({ ...READER, scp: "Releases.Read Releases.Write" });
    const res = await request(app).post("/api/releases").set(bearer(token)).send(body);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain("Curator");
  });

  it("Curator POST /api/releases -> 201", async () => {
    const res = await request(app).post("/api/releases").set(bearer(await issuer.sign(CURATOR))).send(body);
    expect(res.status).toBe(201);
  });

  it("auth is checked before validation: anonymous with an invalid body still gets 401, not 400", async () => {
    expect401(await request(app).post("/api/releases").send({ nonsense: true }));
  });
});
