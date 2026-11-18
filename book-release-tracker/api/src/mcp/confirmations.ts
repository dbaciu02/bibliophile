import { randomBytes } from "node:crypto";
import type { Db, DbClient } from "../db.js";

/**
 * One-time confirmation codes for MCP write tools (F12: "a write tool that
 * requires confirmation").
 *
 * Call 1 (no code):   the tool writes NOTHING; it returns a code and a
 *                     question for the user ("Add X to your watchlist?").
 * Call 2 (with code): only if the user agreed. The code must be unused,
 *                     unexpired, and issued to the same user for the same
 *                     tool and arguments; it's consumed in the same database
 *                     transaction as the write, so it can never work twice.
 *
 * This works in every MCP host. (The 2026-07-28 protocol also has an
 * in-protocol confirmation prompt, `inputRequired`, but not every host and
 * not 2025-era clients support it yet.)
 */

export const CONFIRMATION_TTL_SECONDS = 5 * 60;

export async function issueConfirmation(
  db: Db | DbClient,
  subject: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString("base64url");
  const { rows } = await db.query<{ expires_at: Date }>(
    `INSERT INTO mcp_confirmations (token, subject, tool, args, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))
     RETURNING expires_at`,
    [token, subject, tool, JSON.stringify(args), CONFIRMATION_TTL_SECONDS],
  );
  return { token, expiresAt: (rows[0]?.expires_at ?? new Date()).toISOString() };
}

/**
 * Marks the code used if — and only if — it matches everything. Returns false
 * otherwise (wrong user, other arguments, expired, already used, unknown).
 * Must run on the same transaction as the write it authorizes.
 */
export async function consumeConfirmation(
  client: DbClient,
  token: string,
  subject: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE mcp_confirmations SET used_at = now()
      WHERE token = $1 AND subject = $2 AND tool = $3 AND args = $4::jsonb
        AND used_at IS NULL AND expires_at > now()`,
    [token, subject, tool, JSON.stringify(args)],
  );
  return rowCount === 1;
}
