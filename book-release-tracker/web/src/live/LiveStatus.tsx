import type { LiveEvent, LiveStatus as Status } from "./useLiveEvents";

const LABEL: Record<Status, string> = {
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
};

/** Small "● Live" / "Reconnecting…" pill. */
export function LiveStatusPill({ status }: { status: Status }) {
  return (
    <span className={`live-pill live-${status}`} title="Live updates">
      <span className="dot" aria-hidden="true" /> {LABEL[status]}
    </span>
  );
}

const DESCRIBE: Record<LiveEvent["type"], string> = {
  "release.created": "added",
  "release.updated": "changed",
  "release.hidden": "removed",
  reset: "too far behind, list reloaded",
  connected: "connected",
};

/**
 * Recent live events, newest first. Mainly for the kill-and-recover demo:
 * after a reconnect you can see each missed event arrive once, in id order.
 */
export function LiveLog({ log }: { log: LiveEvent[] }) {
  return (
    <details className="live-log">
      <summary>Live update log ({log.filter((e) => e.type !== "connected").length})</summary>
      {log.length === 0 ? (
        <p className="muted">No updates yet.</p>
      ) : (
        <ol reversed>
          {log.map((e, i) => (
            <li key={`${e.type}-${e.id}-${i}`}>
              <code>{e.receivedAt.toLocaleTimeString()}</code> {e.id > 0 && <code>#{e.id}</code>}{" "}
              {e.data.title ? <strong>{e.data.title}</strong> : e.data.id ? `release ${e.data.id}` : null} {DESCRIBE[e.type]}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
