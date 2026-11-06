import { useCallback, useEffect, useState } from "react";

/**
 * Every remote call in the UI goes through this hook, so every call has the
 * same visible states required by F2: loading, empty, error.
 *
 * `parse` validates the response at runtime — the server's JSON is not trusted
 * just because TypeScript has a type for it. Pass `parse`, `isEmpty` and
 * `getToken` as stable references (module-level or useCallback), or the
 * request re-runs on every render.
 */
export type RemoteState<T> =
  | { status: "loading" }
  | { status: "error"; message: string; httpStatus?: number; requestId?: string }
  | { status: "empty" }
  | { status: "ready"; data: T };

export interface RemoteOptions<T> {
  isEmpty?: (data: T) => boolean;
  /** When given, the request is sent with `Authorization: Bearer <token>`. */
  getToken?: () => Promise<string | null>;
}

interface ApiErrorBody {
  error: { code: string; message: string; requestId: string };
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const e = (value as { error: unknown }).error;
  return typeof e === "object" && e !== null && "message" in e && "requestId" in e;
}

const never = () => false;

export function useRemote<T>(
  url: string,
  parse: (json: unknown) => T,
  { isEmpty = never, getToken }: RemoteOptions<T> = {},
): { state: RemoteState<T>; retry: () => void } {
  const [state, setState] = useState<RemoteState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });

    (async () => {
      try {
        const headers: Record<string, string> = { Accept: "application/json" };
        if (getToken) {
          const token = await getToken();
          if (!token) {
            setState({ status: "error", message: "You need to sign in first", httpStatus: 401 });
            return;
          }
          headers.Authorization = `Bearer ${token}`;
        }
        const res = await fetch(url, { signal: controller.signal, headers });
        const json: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          setState(
            isApiErrorBody(json)
              ? { status: "error", message: json.error.message, httpStatus: res.status, requestId: json.error.requestId }
              : { status: "error", message: `Request failed (${res.status})`, httpStatus: res.status },
          );
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
  }, [url, parse, isEmpty, getToken, attempt]);

  return { state, retry };
}
