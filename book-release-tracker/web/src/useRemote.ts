import { useCallback, useEffect, useState } from "react";

/**
 * Every remote call in the UI goes through this hook, so every call has the
 * same three visible states required by F2: loading, empty, error.
 *
 * `parse` validates the response at runtime — the server's JSON is not trusted
 * just because TypeScript has a type for it.
 */
export type RemoteState<T> =
  | { status: "loading" }
  | { status: "error"; message: string; requestId?: string }
  | { status: "empty" }
  | { status: "ready"; data: T };

interface ApiErrorBody {
  error: { code: string; message: string; requestId: string };
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const e = (value as { error: unknown }).error;
  return typeof e === "object" && e !== null && "message" in e && "requestId" in e;
}

export function useRemote<T>(
  url: string,
  parse: (json: unknown) => T,
  isEmpty: (data: T) => boolean = () => false,
): { state: RemoteState<T>; retry: () => void } {
  const [state, setState] = useState<RemoteState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });

    (async () => {
      try {
        const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
        const json: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          if (isApiErrorBody(json)) {
            setState({ status: "error", message: json.error.message, requestId: json.error.requestId });
          } else {
            setState({ status: "error", message: `Request failed (${res.status})` });
          }
          return;
        }
        const data = parse(json);
        setState(isEmpty(data) ? { status: "empty" } : { status: "ready", data });
      } catch (err) {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: err instanceof Error ? err.message : "Network error" });
      }
    })();

    return () => controller.abort();
  }, [url, parse, isEmpty, attempt]);

  return { state, retry };
}
