import pg from "pg";

export type Db = pg.Pool;

export function createDb(databaseUrl: string): Db {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 3_000,
    // Stop runaway queries instead of letting them hold a connection forever.
    statement_timeout: 5_000,
  });
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
