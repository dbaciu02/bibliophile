import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";
import { createEventHub, type EventHub } from "../src/events/hub.js";
import { resetDb, TEST_DATABASE_URL } from "./helpers.js";
import { createTestIssuer, CURATOR, READER } from "./tokens.js";

// F11: live updates over SSE; reconnect without losing or duplicating events.
// These tests use a REAL listening server and real streaming connections.

const db = createDb(TEST_DATABASE_URL);
const sql = new pg.Client({ connectionString: TEST_DATABASE_URL });
let hub: EventHub;
let server: Server;
let base: string;
let curator: string;
let reader: string;

beforeAll(async () => {
  await resetDb();
  await sql.connect();
  hub = await createEventHub(db, TEST_DATABASE_URL, { log: () => {} });
  const issuer = await createTestIssuer();
  curator = await issuer.sign(CURATOR);
  reader = await issuer.sign(READER);
  const app = createApp({ db, gitSha: "test", verifyToken: issuer.verifier, events: hub });
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  await hub.close();
  await sql.end();
  await db.end();
});

// ---------------------------------------------------------------- helpers
interface Received {
  id: number;
  event: string;
  data: unknown;
}

/** Opens /api/events and parses the stream. Use `waitFor(n)` to collect n events. */
function connect(lastEventId?: number, { viaQuery = false } = {}) {
  const controller = new AbortController();
  const events: Received[] = [];
  let headers: Headers | null = null;
  const waiters: (() => void)[] = [];
  const url = viaQuery && lastEventId !== undefined ? `${base}/api/events?lastEventId=${lastEventId}` : `${base}/api/events`;
  const init: RequestInit = { signal: controller.signal, headers: {} };
  if (!viaQuery && lastEventId !== undefined) (init.headers as Record<string, string>)["Last-Event-ID"] = String(lastEventId);

  const ready = fetch(url, init).then(async (res) => {
    headers = res.headers;
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf("\n\n")) >= 0) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const fields: Record<string, string> = {};
            for (const line of block.split("\n")) {
              if (line.startsWith(":")) continue; // comment / heartbeat
              const colon = line.indexOf(":");
              if (colon > 0) fields[line.slice(0, colon)] = line.slice(colon + 1).trimStart();
            }
            if (fields.event && fields.id) {
              events.push({ id: Number(fields.id), event: fields.event, data: JSON.parse(fields.data ?? "null") });
              waiters.splice(0).forEach((w) => w());
            }
          }
        }
      } catch {
        /* aborted */
      }
    })();
  });

  return {
    events,
    ready,
    get headers() {
      return headers;
    },
    async waitFor(n: number, timeoutMs = 3000): Promise<Received[]> {
      const deadline = Date.now() + timeoutMs;
      while (events.length < n) {
        if (Date.now() > deadline) throw new Error(`expected ${n} events, got ${events.length}: ${JSON.stringify(events)}`);
        await new Promise<void>((r) => {
          waiters.push(r);
          setTimeout(r, 50);
        });
      }
      return events.slice(0, n);
    },
    close: () => controller.abort(),
  };
}

const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

let vol = 0;
async function createRelease(title = `Live Book ${++vol}`): Promise<number> {
  const res = await fetch(`${base}/api/releases`, {
    method: "POST",
    headers: { Authorization: `Bearer ${curator}`, "Content-Type": "application/json" },
    body: JSON.stringify({ googleVolumeId: `live${++vol}`, title, publishedDate: "2027-05", authors: ["Ana Synthetic"] }),
  });
  if (res.status !== 201) throw new Error(`create failed: ${res.status}`);
  return ((await res.json()) as { id: number }).id;
}

async function latestEventId(): Promise<number> {
  const r = await sql.query(`SELECT coalesce(max(id), 0)::int AS id FROM events`);
  return r.rows[0].id;
}

const ids = (evs: Received[]) => evs.map((e) => e.id);

// ---------------------------------------------------------------- tests
describe("events are written in the same transaction as the change", () => {
  beforeEach(resetDb);

  it("create, update and hide each write exactly one event", async () => {
    const id = await createRelease("Original");
    await fetch(`${base}/api/releases/${id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${curator}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Renamed" }),
    });
    await fetch(`${base}/api/releases/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${curator}` } });

    const r = await sql.query(`SELECT type, payload FROM events ORDER BY id`);
    expect(r.rows).toEqual([
      { type: "release.created", payload: { id, title: "Original", releaseDate: "2027-05-01" } },
      { type: "release.updated", payload: { id, title: "Renamed", releaseDate: "2027-05-01" } },
      { type: "release.hidden", payload: { id } },
    ]);
  });

  it("a rejected write (409) writes no event", async () => {
    const body = JSON.stringify({ googleVolumeId: "dup1", title: "Dup", publishedDate: "2027", authors: ["A"] });
    const headers = { Authorization: `Bearer ${curator}`, "Content-Type": "application/json" };
    expect((await fetch(`${base}/api/releases`, { method: "POST", headers, body })).status).toBe(201);
    expect((await fetch(`${base}/api/releases`, { method: "POST", headers, body })).status).toBe(409);
    expect(await latestEventId()).toBe(1);
  });

  it("personal watchlist changes are never broadcast", async () => {
    await fetch(`${base}/api/me/watchlist`, {
      method: "POST",
      headers: { Authorization: `Bearer ${reader}`, "Content-Type": "application/json" },
      body: JSON.stringify({ authorName: "Private Interest" }),
    });
    expect(await latestEventId()).toBe(0);
  });
});

describe("GET /api/events (SSE)", () => {
  beforeEach(resetDb);

  it("is a public, uncacheable event stream", async () => {
    const c = connect();
    await c.ready;
    expect(c.headers?.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(c.headers?.get("cache-control")).toBe("no-store, no-transform");
    c.close();
  });

  it("a new client gets live events as they happen, not old history", async () => {
    await createRelease("Before connecting");
    const c = connect();
    await c.ready;
    await settle();
    const id = await createRelease("After connecting");
    const [e] = await c.waitFor(1);
    expect(e).toMatchObject({ event: "release.created", data: { id, title: "After connecting" } });
    await settle();
    expect(c.events).toHaveLength(1); // "Before connecting" was not sent
    c.close();
  });

  it("KILL AND RECOVER: events written while disconnected are replayed on reconnect, exactly once, in order", async () => {
    const first = connect();
    await first.ready;
    await settle();
    await createRelease("Seen before the drop");
    const [seen] = await first.waitFor(1);
    first.close(); // connection killed

    await createRelease("Missed 1");
    await createRelease("Missed 2");
    await createRelease("Missed 3");

    // Reconnect the way EventSource does: Last-Event-ID = last id received.
    const again = connect(seen!.id);
    const replayed = await again.waitFor(3);
    expect(replayed.map((e) => (e.data as { title: string }).title)).toEqual(["Missed 1", "Missed 2", "Missed 3"]);
    expect(ids(replayed)).toEqual([seen!.id + 1, seen!.id + 2, seen!.id + 3]);

    // ...and then keeps receiving live events.
    await createRelease("Live after reconnect");
    await again.waitFor(4);
    await settle();
    expect(again.events).toHaveLength(4);
    again.close();
  });

  it("?lastEventId= works the same for a page that reloads", async () => {
    await createRelease("A");
    const after = await latestEventId();
    await createRelease("B");
    const c = connect(after, { viaQuery: true });
    const [e] = await c.waitFor(1);
    expect((e!.data as { title: string }).title).toBe("B");
    c.close();
  });

  it("NO DUPLICATES even when writes happen DURING the replay", async () => {
    for (let i = 0; i < 5; i++) await createRelease();
    const c = connect(0); // replay all 5 ...
    const writes = Promise.all(Array.from({ length: 5 }, () => createRelease())); // ...while 5 more arrive live
    await writes;
    const got = await c.waitFor(10, 5000);
    await settle(500);
    expect(c.events).toHaveLength(10);
    const list = ids(got);
    expect(new Set(list).size).toBe(10); // no duplicates
    expect(list).toEqual([...list].sort((a, b) => a - b)); // in order
    expect(list).toEqual(Array.from({ length: 10 }, (_, i) => i + 1)); // no gaps
    c.close();
  });

  it("NO LOST EVENTS when many curators save at the same moment (commit order != id order)", async () => {
    const c = connect();
    await c.ready;
    await settle();
    await Promise.all(Array.from({ length: 30 }, () => createRelease()));
    const got = await c.waitFor(30, 8000);
    expect(new Set(ids(got)).size).toBe(30);
    expect(ids(got)).toEqual([...ids(got)].sort((a, b) => a - b));
    c.close();
  }, 15_000);

  it("NO GAP for a brand-new client when the server is slow to look up where to start", async () => {
    // Make the start-point lookup slow and stale, like a busy database: it reads
    // the latest id, then takes 600 ms to answer. Books are added during that pause.
    const slowHub: EventHub = {
      ...hub,
      latestId: async () => {
        const v = await hub.latestId();
        await new Promise((r) => setTimeout(r, 600));
        return v;
      },
    };
    const issuer = await createTestIssuer();
    const app = createApp({ db, gitSha: "test", verifyToken: issuer.verifier, events: slowHub });
    const s = app.listen(0);
    await new Promise<void>((r) => s.once("listening", () => r()));
    const port = (s.address() as AddressInfo).port;
    const controller = new AbortController();
    const got: string[] = [];
    void fetch(`http://127.0.0.1:${port}/api/events`, { signal: controller.signal })
      .then(async (res) => {
        const reader = res.body!.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          got.push(new TextDecoder().decode(value));
        }
      })
      .catch(() => {});
    await settle(150); // the request has reached the server, which is now in the slow lookup
    await createRelease("During the slow lookup 1");
    await createRelease("During the slow lookup 2");
    await settle(1200);
    controller.abort();
    s.closeAllConnections();
    s.close();
    const text = got.join("");
    expect(text).toContain("During the slow lookup 1");
    expect(text).toContain("During the slow lookup 2");
  });

  it("several clients each get every event", async () => {
    const a = connect();
    const b = connect();
    await Promise.all([a.ready, b.ready]);
    await settle();
    await createRelease();
    await createRelease();
    expect(ids(await a.waitFor(2))).toEqual(ids(await b.waitFor(2)));
    a.close();
    b.close();
  });

  it("sends a named `ping` event (no id) as a heartbeat, so the page can spot a dead stream", async () => {
    const app = createApp({ db, gitSha: "test", verifyToken: () => Promise.reject(new Error("x")), events: hub, eventsHeartbeatMs: 100 });
    const s = app.listen(0);
    await new Promise<void>((r) => s.once("listening", () => r()));
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/api/events`, { signal: controller.signal });
    const reader = res.body!.getReader();
    let text = "";
    const deadline = Date.now() + 2000;
    while (!text.includes("event: ping") && Date.now() < deadline) {
      const { value } = await reader.read();
      text += new TextDecoder().decode(value);
    }
    controller.abort();
    s.closeAllConnections();
    s.close();
    expect(text).toContain("event: ping\ndata: {}\n\n");
    expect(text).not.toMatch(/id: [^\n]*\nevent: ping/);
  });

  it("a Last-Event-ID the server never issued (database was reset) -> reset event", async () => {
    await createRelease();
    const c = connect(999_999);
    const [e] = await c.waitFor(1);
    expect(e!.event).toBe("reset");
    c.close();
  });

  it("events older than the replay window (pruned) -> reset event instead of a silent gap", async () => {
    for (let i = 0; i < 3; i++) await createRelease();
    await sql.query(`DELETE FROM events WHERE id <= 2`); // as the 7-day retention would
    const c = connect(0);
    const [e] = await c.waitFor(1);
    expect(e!.event).toBe("reset");
    c.close();
  });

  it("the server's database listener is killed: it reconnects and clients still get the event", async () => {
    const c = connect();
    await c.ready;
    await settle();
    const killed = await sql.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE query ILIKE 'LISTEN%' AND datname = current_database() AND pid <> pg_backend_pid()`,
    );
    expect(killed.rowCount).toBeGreaterThan(0);
    await createRelease("Written while the listener was down");
    const [e] = await c.waitFor(1, 6000); // catch-up after reconnect
    expect((e!.data as { title: string }).title).toBe("Written while the listener was down");
    c.close();
  }, 10_000);
});
