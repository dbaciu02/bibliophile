import pg from "pg";
import { log } from "./log.js";

// Return DATE columns as plain "YYYY-MM-DD" strings. By default pg turns them
// into JS Date objects at local midnight, which shifts the day in some time
// zones. 1082 is Postgres' type id for DATE.
pg.types.setTypeParser(1082, (value: string) => value);

export type Db = pg.Pool;
export type DbClient = pg.PoolClient;

export function createDb(databaseUrl: string): Db {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 3_000,
    // Stop runaway queries instead of letting them hold a connection forever.
    statement_timeout: 5_000,
  });
  // When the database drops an IDLE connection (restart, failover, a killed
  // session), the pool emits "error". Without a listener Node treats that as
  // an unhandled error and the whole API process exits. With it, the broken
  // connection is discarded, requests that need the database fail with 500 /
  // healthz 503 while it's down, and everything recovers by itself when it's
  // back. (Found while rehearsing the Game Day: S2.)
  pool.on("error", (err) => log("warn", "database connection lost (pool will reconnect)", { err: String(err) }));
  return pool;
}

/**
 * Runs `work` inside one transaction. Every write route uses this so the data
 * change and its audit row are saved together or not at all (F6).
 */
export async function withTransaction<T>(db: Db, work: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** True if `err` is a Postgres unique-constraint violation (used to return 409). */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; constraint?: unknown };
  return e.code === "23505" && (constraint === undefined || e.constraint === constraint);
}

/** Cheap liveness check for /healthz. Rejects if the DB doesn't answer in time. */
export async function pingDb(db: Db, timeoutMs = 1_000): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("database ping timed out")), timeoutMs);
  });
  try {
    await Promise.race([db.query("SELECT 1"), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
