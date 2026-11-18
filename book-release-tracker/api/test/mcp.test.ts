/**
 * F12 — MCP server. Exercises the real HTTP endpoint with the official MCP
 * client SDK (for protocol behaviour) and raw fetch (for HTTP status codes and
 * WWW-Authenticate headers, which the client hides behind exceptions).
 */
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";
import { resetDb, TEST_DATABASE_URL } from "./helpers.js";
import { bearer, createTestIssuer, CURATOR, READER, READER_2, TEST_AUDIENCE, TEST_ISSUER, type TestIssuer } from "./tokens.js";

const db = createDb(TEST_DATABASE_URL);
const sql = new pg.Client({ connectionString: TEST_DATABASE_URL });
const APP_HTML = "<!doctype html><title>calendar</title><p>test app</p>";
const full = (s: string) => `api://${TEST_AUDIENCE}/${s}`;

let issuer: TestIssuer;
let server: Server;
let base: string;
const clients: Client[] = [];

async function connect(token: string): Promise<Client> {
  const client = new Client({ name: "bibliophile-tests", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  clients.push(client);
  return client;
}

/** One raw JSON-RPC POST, so the test can see the HTTP status and headers. */
async function rpc(token: string | null, method: string, params: Record<string, unknown> = {}) {
  return fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

const auditRows = async (action: string, entityId?: string) =>
  (
    await sql.query(
      `SELECT actor_subject, actor_role, action, entity_id, after, request_id FROM audit_log
       WHERE action = $1 AND ($2::text IS NULL OR entity_id = $2) ORDER BY id`,
      [action, entityId ?? null],
    )
  ).rows;

beforeAll(async () => {
  await resetDb();
  await sql.connect();
  issuer = await createTestIssuer();
  // Listen first so the public base URL can carry the real port.
  const holder: { app?: ReturnType<typeof createApp> } = {};
  server = (await new Promise<Server>((resolve) => {
    const s = createServer((req, res) => holder.app!(req, res));
    s.listen(0, "127.0.0.1", () => resolve(s));
  })) as Server;
  const port = (server.address() as AddressInfo).port;
  base = `http://localhost:${port}`;
  holder.app = createApp({
    db,
    gitSha: "test",
    verifyToken: issuer.verifier,
    mcp: { apiAudience: TEST_AUDIENCE, issuer: TEST_ISSUER, publicBaseUrl: new URL(base), appHtml: () => APP_HTML },
  });

  const curator = bearer(await issuer.sign(CURATOR));
  for (const [vol, date, author] of [
    ["mcp1", "2099-02-10", "Mcp Author"],
    ["mcp2", "2099-03", "Mcp Author"],
    ["mcp3", "2020-01-01", "Mcp Author"],
    ["mcp4", "2099-02-20", "Other Writer"],
  ] as const) {
    await request(holder.app)
      .post("/api/releases")
      .set(curator)
      .send({ googleVolumeId: vol, title: `Book ${vol}`, publishedDate: date, authors: [author], categories: ["Fantasy"] })
      .expect(201);
  }
});

afterAll(async () => {
  for (const c of clients) await c.close().catch(() => {});
  await new Promise((r) => server.close(r));
  await sql.end();
  await db.end();
});

describe("MCP authorization metadata (RFC 9728)", () => {
  it("publishes protected-resource metadata pointing at Entra ID", async () => {
    const res = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.resource).toBe(`${base}/mcp`);
    expect(body.authorization_servers).toEqual([TEST_ISSUER]);
    expect(body.scopes_supported).toEqual([full("Releases.Read"), full("Watchlist.ReadWrite")]);
  });

  it("no token -> 401 with WWW-Authenticate naming the metadata URL", async () => {
    const res = await rpc(null, "tools/list");
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain(`resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`);
  });

  it("bad signature, wrong audience and expired tokens -> 401 invalid_token", async () => {
    for (const token of [
      await issuer.signWithUntrustedKey(),
      await issuer.sign({ aud: "someone-else" }),
      await issuer.sign({ expiresIn: -60 }),
    ]) {
      const res = await rpc(token, "tools/list");
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
    }
  });

  it("rejects a foreign Host header (DNS-rebinding guard)", async () => {
    const res = await request(server).post("/mcp").set("Host", "evil.example").send({});
    expect(res.status).toBe(403);
  });
});

describe("MCP tools", () => {
  let reader: Client;
  beforeAll(async () => {
    reader = await connect(await issuer.sign(READER));
  });

  it("lists six tools; only add_to_watchlist is not read-only", async () => {
    const { tools } = await reader.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "add_to_watchlist",
      "get_my_watchlist",
      "get_release",
      "search_releases",
      "show_release_calendar",
      "upcoming_for_author",
    ]);
    const writers = tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name);
    expect(writers).toEqual(["add_to_watchlist"]);
    for (const t of tools) expect(t.inputSchema.type).toBe("object");
  });

  it("search_releases defaults to upcoming only and returns structured releases", async () => {
    const res = await reader.callTool({ name: "search_releases", arguments: { author: "mcp author" } });
    expect(res.isError).toBeFalsy();
    const titles = (res.structuredContent as { releases: { title: string }[] }).releases.map((r) => r.title);
    expect(titles).toEqual(["Book mcp1", "Book mcp2"]);
  });

  it("search_releases validates input (bad date -> error, nothing thrown at the transport)", async () => {
    const res = await reader.callTool({ name: "search_releases", arguments: { from: "next tuesday" } });
    expect(res.isError).toBe(true);
  });

  it("get_release on an unknown id -> isError with a plain message", async () => {
    const res = await reader.callTool({ name: "get_release", arguments: { id: 999999 } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toMatch(/no release/i);
  });

  it("upcoming_for_author returns only future books by that author", async () => {
    const res = await reader.callTool({ name: "upcoming_for_author", arguments: { author: "Mcp Author" } });
    const titles = (res.structuredContent as { releases: { title: string }[] }).releases.map((r) => r.title);
    expect(titles).toEqual(["Book mcp1", "Book mcp2"]);
  });

  it("every tool call is audited with the caller from the token", async () => {
    const rows = await auditRows("mcp.tool_call", "upcoming_for_author");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.at(-1)).toMatchObject({ actor_subject: READER.oid, actor_role: "Reader" });
    expect(rows.at(-1).after.arguments).toEqual({ author: "Mcp Author" });
    expect(rows.at(-1).request_id).toMatch(/\S/);
  });
});

describe("add_to_watchlist: explicit confirmation before any write", () => {
  let reader: Client;
  let reader2: Client;
  const watchCount = async (oid: string) =>
    Number(
      (
        await sql.query(
          `SELECT count(*) FROM watchlist_items w JOIN users u ON u.id = w.user_id WHERE u.idp_subject = $1`,
          [oid],
        )
      ).rows[0].count,
    );

  beforeAll(async () => {
    reader = await connect(await issuer.sign(READER));
    reader2 = await connect(await issuer.sign(READER_2));
  });

  const ask = async (c: Client, authorName: string) => {
    const res = await c.callTool({ name: "add_to_watchlist", arguments: { authorName } });
    return res.structuredContent as { status: string; confirmationToken: string; question: string };
  };

  it("first call writes nothing and returns a confirmation question + token", async () => {
    const before = await watchCount(READER.oid);
    const r = await ask(reader, "Mcp Author");
    expect(r.status).toBe("confirmation_required");
    expect(r.question).toContain("Mcp Author");
    expect(r.confirmationToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await watchCount(READER.oid)).toBe(before);
  });

  it("the token works once; replaying it is refused", async () => {
    const { confirmationToken } = await ask(reader, "Mcp Author");
    const ok = await reader.callTool({ name: "add_to_watchlist", arguments: { authorName: "Mcp Author", confirmationToken } });
    expect(ok.isError).toBeFalsy();
    expect(ok.structuredContent).toMatchObject({ status: "added", item: { author: "Mcp Author", upcomingCount: 2 } });

    const again = await reader.callTool({ name: "add_to_watchlist", arguments: { authorName: "Mcp Author", confirmationToken } });
    expect(again.isError).toBe(true);
    expect(await watchCount(READER.oid)).toBe(1);
  });

  it("already-followed author -> error, no token issued", async () => {
    const res = await reader.callTool({ name: "add_to_watchlist", arguments: { authorName: "Mcp Author" } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toMatch(/already watching/i);
  });

  it("a token is bound to its author and its user", async () => {
    const { confirmationToken } = await ask(reader, "Other Writer");
    // Same user, different author.
    const wrongAuthor = await reader.callTool({ name: "add_to_watchlist", arguments: { authorName: "Someone Else", confirmationToken } });
    expect(wrongAuthor.isError).toBe(true);
    // Different user, same author.
    const wrongUser = await reader2.callTool({ name: "add_to_watchlist", arguments: { authorName: "Other Writer", confirmationToken } });
    expect(wrongUser.isError).toBe(true);
    expect(await watchCount(READER_2.oid)).toBe(0);
    // The rightful owner can still use it.
    const ok = await reader.callTool({ name: "add_to_watchlist", arguments: { authorName: "Other Writer", confirmationToken } });
    expect(ok.structuredContent).toMatchObject({ status: "added" });
  });

  it("an expired token is refused", async () => {
    const { confirmationToken } = await ask(reader2, "Mcp Author");
    await sql.query(`UPDATE mcp_confirmations SET expires_at = now() - interval '1 second' WHERE token = $1`, [confirmationToken]);
    const res = await reader2.callTool({ name: "add_to_watchlist", arguments: { authorName: "Mcp Author", confirmationToken } });
    expect(res.isError).toBe(true);
    expect(await watchCount(READER_2.oid)).toBe(0);
  });

  it("the write is audited twice: the watchlist change and the tool call (token redacted)", async () => {
    const adds = (await sql.query(`SELECT actor_subject, after FROM audit_log WHERE action = 'watchlist.add' ORDER BY id`)).rows;
    expect(adds.map((r) => r.after.author)).toEqual(["Mcp Author", "Other Writer"]);
    const calls = await auditRows("mcp.tool_call", "add_to_watchlist");
    expect(calls.map((r) => r.after.outcome)).toContain("confirmation_required");
    expect(calls.map((r) => r.after.outcome)).toContain("added");
    expect(JSON.stringify(calls)).not.toMatch(/[A-Za-z0-9_-]{43}/);
    expect(calls.some((r) => r.after.arguments.confirmationToken === "[redacted]")).toBe(true);
  });

  it("get_my_watchlist shows only the caller's own items", async () => {
    const mine = await reader.callTool({ name: "get_my_watchlist", arguments: {} });
    const theirs = await reader2.callTool({ name: "get_my_watchlist", arguments: {} });
    expect((mine.structuredContent as { items: unknown[] }).items).toHaveLength(2);
    expect((theirs.structuredContent as { items: unknown[] }).items).toHaveLength(0);
  });
});

describe("scopes and roles", () => {
  it("a read-only token is refused on write tools: 403 insufficient_scope (step-up), and audited", async () => {
    const readOnly = await issuer.sign({ ...READER, scp: "Releases.Read" });
    for (const name of ["add_to_watchlist", "get_my_watchlist"]) {
      const res = await rpc(readOnly, "tools/call", { name, arguments: { authorName: "Mcp Author" } });
      expect(res.status).toBe(403);
      const challenge = res.headers.get("www-authenticate") ?? "";
      expect(challenge).toContain('error="insufficient_scope"');
      expect(challenge).toContain(full("Watchlist.ReadWrite"));
      expect(challenge).toContain("resource_metadata=");
    }
    const refused = await auditRows("mcp.tool_refused");
    expect(refused.map((r) => r.entity_id)).toEqual(["add_to_watchlist", "get_my_watchlist"]);
    expect(refused[0].after).toMatchObject({ reason: "insufficient_scope", required: full("Watchlist.ReadWrite") });
  });

  it("a read-only token can still read", async () => {
    const c = await connect(await issuer.sign({ ...READER, scp: "Releases.Read" }));
    const res = await c.callTool({ name: "search_releases", arguments: {} });
    expect(res.isError).toBeFalsy();
  });

  it("a token with only Watchlist.ReadWrite is refused on catalog tools", async () => {
    const t = await issuer.sign({ ...READER, scp: "Watchlist.ReadWrite" });
    const res = await rpc(t, "tools/call", { name: "search_releases", arguments: {} });
    expect(res.status).toBe(403);
    expect(res.headers.get("www-authenticate")).toContain(full("Releases.Read"));
  });

  it("a signed-in user with no app role gets an isError result and no data", async () => {
    const c = await connect(await issuer.sign({ ...READER, oid: "44444444-4444-4444-4444-444444444444", roles: [] }));
    const res = await c.callTool({ name: "search_releases", arguments: {} });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toBeUndefined();
    expect(JSON.stringify(res.content)).toMatch(/no Bibliophile role/);
  });
});

describe("MCP App (F13 resource)", () => {
  it("show_release_calendar links to the ui:// resource (both meta keys)", async () => {
    const c = await connect(await issuer.sign(READER));
    const { tools } = await c.listTools();
    const cal = tools.find((t) => t.name === "show_release_calendar")!;
    expect(cal._meta).toEqual({
      ui: { resourceUri: "ui://bibliophile/release-calendar.html" },
      "ui/resourceUri": "ui://bibliophile/release-calendar.html",
    });
    const res = await c.callTool({ name: "show_release_calendar", arguments: { months: 12 } });
    expect(res.structuredContent).toMatchObject({ status: "ok", releases: expect.any(Array) });
  });

  it("serves the app HTML with the MCP App mime type and a tight CSP", async () => {
    const c = await connect(await issuer.sign(READER));
    const { resources } = await c.listResources();
    expect(resources.map((r) => r.uri)).toEqual(["ui://bibliophile/release-calendar.html"]);
    const { contents } = await c.readResource({ uri: "ui://bibliophile/release-calendar.html" });
    expect(contents[0]).toMatchObject({
      mimeType: "text/html;profile=mcp-app",
      text: APP_HTML,
      _meta: { ui: { csp: { resourceDomains: ["https://books.google.com"] } } },
    });
  });

  it("responses are never cached", async () => {
    const res = await rpc(await issuer.sign(READER), "tools/list");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
