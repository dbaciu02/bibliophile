import type { Principal } from "./auth.js";
import type { DbClient } from "./db.js";

export type AuditAction =
  | "release.create"
  | "release.update"
  | "release.hide"
  | "watchlist.add"
  | "watchlist.remove";

/**
 * Appends one row to the audit trail (F6). Always called with the SAME client
 * (transaction) as the change it records, so you never get a change without
 * an audit row or an audit row for a change that was rolled back.
 * The actor comes from the validated token, never from the request body.
 */
export async function writeAudit(
  client: DbClient,
  entry: {
    actor: Principal;
    action: AuditAction;
    entityType: "book" | "watchlist_item";
    entityId: string | number;
    before: unknown;
    after: unknown;
    requestId: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (actor_subject, actor_role, action, entity_type, entity_id, before, after, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.actor.subject,
      entry.actor.roles.join(","),
      entry.action,
      entry.entityType,
      String(entry.entityId),
      entry.before === null ? null : JSON.stringify(entry.before),
      entry.after === null ? null : JSON.stringify(entry.after),
      entry.requestId,
    ],
  );
}
