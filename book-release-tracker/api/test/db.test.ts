/**
 * Resilience: a dropped database connection must not crash the API (S2).
 * Postgres really terminates the pooled connection here (pg_terminate_backend),
 * which is what a database restart or failover looks like to the pool.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { createDb } from "../src/db.js";
import { TEST_DATABASE_URL } from "./helpers.js";

const db = createDb(TEST_DATABASE_URL);
const admin = createDb(TEST_DATABASE_URL);
afterAll(async () => {
  await db.end();
  await admin.end();
});

describe("database pool", () => {
  it("survives the server killing an idle connection, and reconnects by itself", async () => {
    const { rows } = await db.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    const pid = rows[0]!.pid; // that connection is now idle in the pool

    // No listener of our own: without the pool's handler in createDb, the
    // "error" event is unhandled and fails this test run.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await admin.query("SELECT pg_terminate_backend($1)", [pid]);
    await new Promise((r) => setTimeout(r, 300));

    expect(warn.mock.calls.some(([line]) => String(line).includes("database connection lost"))).toBe(true);
    warn.mockRestore();
    const again = await db.query<{ ok: number }>("SELECT 1 AS ok");
    expect(again.rows[0]!.ok).toBe(1);
  });
});
