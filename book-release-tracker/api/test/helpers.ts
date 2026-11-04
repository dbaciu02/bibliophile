import path from "node:path";
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://app:app@localhost:5433/booktracker_test";

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

/**
 * Empty, freshly migrated test database. Rebuilding the schema is the only way
 * to clear audit_log, because the append-only trigger blocks DELETE/TRUNCATE.
 */
export async function resetDb(): Promise<void> {
  await migrate("down");
  await migrate("up");
}

export async function migrate(direction: "up" | "down", count = Infinity): Promise<string[]> {
  const ran = await runner({
    databaseUrl: TEST_DATABASE_URL,
    dir: MIGRATIONS_DIR,
    migrationsTable: "pgmigrations",
    direction,
    count,
    log: () => {}, // keep test output readable; the CLI prints full SQL
  });
  return ran.map((m) => m.name);
}
