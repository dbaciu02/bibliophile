import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, TEST_DATABASE_URL } from "./helpers.js";

// F5: the initial migration is reversible, and both directions are tested.
// F4/F6: keys, the justified index and the append-only audit log exist.

const client = new pg.Client({ connectionString: TEST_DATABASE_URL });

async function tables(): Promise<string[]> {
  const r = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name <> 'pgmigrations'
     ORDER BY table_name`,
  );
  return r.rows.map((row) => row.table_name);
}

const EXPECTED_TABLES = ["audit_log", "authors", "book_authors", "books", "events", "users", "watchlist_items"];

beforeAll(async () => {
  await client.connect();
  await migrate("down"); // start from an empty schema whatever state the DB was in
});

afterAll(async () => {
  await migrate("up"); // leave the test DB migrated for the other test files
  await client.end();
});

describe("initial schema migration", () => {
  it("down leaves no application tables", async () => {
    expect(await tables()).toEqual([]);
  });

  it("up creates every table", async () => {
    const ran = await migrate("up");
    expect(ran).toEqual(["1761166800000_initial-schema"]);
    expect(await tables()).toEqual(EXPECTED_TABLES);
  });

  it("creates the published_date index used by calendar range queries", async () => {
    const r = await client.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'books_published_date_idx'`,
    );
    expect(r.rows).toHaveLength(1);
  });

  it("enforces foreign keys (a watchlist item needs a real user and author)", async () => {
    await expect(
      client.query(`INSERT INTO watchlist_items (user_id, author_id) VALUES (999999, 999999)`),
    ).rejects.toMatchObject({ code: "23503" }); // foreign_key_violation
  });

  it("enforces one watchlist entry per (user, author) — the source of 409s", async () => {
    const u = await client.query<{ id: string }>(
      `INSERT INTO users (idp_subject, display_name) VALUES ('test-oid-1', 'Test Reader') RETURNING id`,
    );
    const a = await client.query<{ id: string }>(
      `INSERT INTO authors (name) VALUES ('Synthetic Author') RETURNING id`,
    );
    const userId = u.rows[0]?.id;
    const authorId = a.rows[0]?.id;
    await client.query(`INSERT INTO watchlist_items (user_id, author_id) VALUES ($1, $2)`, [userId, authorId]);
    await expect(
      client.query(`INSERT INTO watchlist_items (user_id, author_id) VALUES ($1, $2)`, [userId, authorId]),
    ).rejects.toMatchObject({ code: "23505" }); // unique_violation
  });

  describe("audit_log is append-only", () => {
    beforeAll(async () => {
      await client.query(
        `INSERT INTO audit_log (actor_subject, actor_role, action, entity_type, entity_id, after, request_id)
         VALUES ('test-oid-1', 'curator', 'release.create', 'book', '1', '{"title":"x"}', 'req-1')`,
      );
    });

    it("allows INSERT", async () => {
      const r = await client.query(`SELECT count(*)::int AS n FROM audit_log`);
      expect(r.rows[0]).toEqual({ n: 1 });
    });

    it.each([
      ["UPDATE", `UPDATE audit_log SET action = 'tampered'`],
      ["DELETE", `DELETE FROM audit_log`],
      ["TRUNCATE", `TRUNCATE audit_log`],
    ])("rejects %s", async (_op, sql) => {
      await expect(client.query(sql)).rejects.toMatchObject({ code: "42501" }); // insufficient_privilege
    });
  });

  it("down removes everything again (reversible)", async () => {
    const ran = await migrate("down");
    expect(ran).toEqual(["1761166800000_initial-schema"]);
    expect(await tables()).toEqual([]);
    const types = await client.query(`SELECT 1 FROM pg_type WHERE typname = 'date_precision'`);
    expect(types.rows).toHaveLength(0);
  });
});
