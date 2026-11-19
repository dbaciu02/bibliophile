import { useEffect, useRef, useState } from "react";
import { apiUrl } from "../api/base";

/**
 * Subscribes to GET /api/events (Server-Sent Events) for live catalog changes (F11).
 *
 * The browser's EventSource does most of the work: when the connection drops
 * it reconnects by itself (after the server's `retry: 3000`) and sends the id
 * of the last event it received as `Last-Event-ID`, so the server replays
 * exactly what was missed. This hook adds:
 *   - a status for the UI: connecting / live / reconnecting;
 *   - a WATCHDOG: the server sends `ping` every 15 s. A proxy or CDN can keep
 *     a stream open after the server behind it died, and EventSource can't
 *     tell. If nothing arrives for 35 s we close it ourselves and reconnect
 *     with ?lastEventId=<last id seen>, so the replay still covers the gap;
 *   - a second guard against duplicates: ids at or below the last one handled are ignored;
 *   - `onEvent` calls for changes, `reset` (server couldn't replay: reload),
 *     and `connected` (first connection: the page re-fetches once to cover
 *     anything that changed between loading the list and the stream opening);
 *   - a short log of recent events for the on-page "Live update log".
 */

export type LiveStatus = "connecting" | "live" | "reconnecting";

export const LIVE_EVENT_TYPES = ["release.created", "release.updated", "release.hidden"] as const;
export type LiveEventType = (typeof LIVE_EVENT_TYPES)[number];

export interface LiveEvent {
  id: number;
  type: LiveEventType | "reset" | "connected";
  data: { id?: number; title?: string; releaseDate?: string };
  receivedAt: Date;
}

const LOG_SIZE = 20;
export const SILENCE_TIMEOUT_MS = 35_000; // > 2 missed pings (server pings every 15 s)

export function useLiveEvents(onEvent: (e: LiveEvent) => void): { status: LiveStatus; log: LiveEvent[] } {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [log, setLog] = useState<LiveEvent[]>([]);
  const handler = useRef(onEvent);
  handler.current = onEvent; // always call the latest callback without reconnecting

  useEffect(() => {
    if (typeof EventSource === "undefined") return; // very old browsers: page still works, just not live
    let source: EventSource | null = null;
    let lastId = 0;
    let everOpened = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const deliver = (e: LiveEvent) => {
      setLog((old) => [e, ...old].slice(0, LOG_SIZE));
      handler.current(e);
    };

    const armWatchdog = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        // Silence: assume the stream is dead even if the browser thinks it's open.
        setStatus("reconnecting");
        source?.close();
        open();
      }, SILENCE_TIMEOUT_MS);
    };

    const onMessage = (type: LiveEvent["type"]) => (msg: MessageEvent<string>) => {
      armWatchdog();
      const id = Number(msg.lastEventId);
      if (!Number.isFinite(id)) return;
      if (type !== "reset" && id <= lastId) return; // already handled
      lastId = id;
      let data: LiveEvent["data"] = {};
      try {
        const parsed: unknown = JSON.parse(msg.data);
        if (typeof parsed === "object" && parsed !== null) data = parsed as LiveEvent["data"];
      } catch {
        /* keep {} */
      }
      deliver({ id, type, data, receivedAt: new Date() });
    };

    const types: LiveEvent["type"][] = [...LIVE_EVENT_TYPES, "reset"];

    function open() {
      if (stopped) return;
      // A brand-new EventSource doesn't know the last id, so pass it in the URL.
      const s = new EventSource(apiUrl(lastId > 0 ? `/api/events?lastEventId=${lastId}` : "/api/events"));
      source = s;
      s.onopen = () => {
        setStatus("live");
        armWatchdog();
        if (!everOpened) {
          everOpened = true;
          deliver({ id: 0, type: "connected", data: {}, receivedAt: new Date() });
        }
      };
      s.onerror = () => {
        // The browser retries by itself (readyState CONNECTING). If it gave up
        // (CLOSED), the watchdog will open a new connection.
        setStatus("reconnecting");
        armWatchdog();
      };
      s.addEventListener("ping", armWatchdog);
      for (const t of types) s.addEventListener(t, onMessage(t) as EventListener);
      armWatchdog();
    }

    open();
    return () => {
      stopped = true;
      clearTimeout(watchdog);
      source?.close();
    };
  }, []);

  return { status, log };
}
