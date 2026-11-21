import { useCallback, useEffect, useState } from "react";
import { apiUrl } from "./api/base";

/**
 * Every remote call in the UI goes through this hook, so every call has the
 * same visible states required by F2: loading, empty, error.
 *
 * `parse` validates the response at runtime — the server's JSON is not trusted
 * just because TypeScript has a type for it. Pass `parse`, `isEmpty` and
 * `getToken` as stable references (module-level or useCallback), or the
 * request re-runs on every render.
 *
 * `retry()` shows the loading state again (the user asked for it).
 * `refresh()` re-fetches quietly: the current data stays on screen until the
 * new data arrives, and a failed quiet refresh keeps the old data. Live
 * updates use refresh() so the list doesn't flash.
 *
 * `cdn: true` (public catalog reads only, D6): the request goes to the site's
 * own origin, where Netlify proxies /api/releases* to the API and its CDN may
 * answer from cache (up to 60 s old). No token is ever sent on this path.
 * `refresh(version)` adds `v=<version>` to the query: a new cache key for each
 * change, so a live update fetches a fresh copy instead of a cached one.
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
  /** Fetch from the site's origin so the CDN can serve it. Public data only. */
  cdn?: boolean;
}

/** "/api/releases?a=1" + "42" -> "/api/releases?a=1&v=42" */
export function withVersion(url: string, version: string | undefined): string {
  if (!version) return url;
  const [path, query = ""] = url.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("v", version);
  return `${path}?${params.toString()}`;
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
  { isEmpty = never, getToken, cdn = false }: RemoteOptions<T> = {},
): { state: RemoteState<T>; retry: () => void; refresh: (version?: string) => void } {
  if (cdn && getToken) throw new Error("useRemote: a CDN-cached request must not carry a token");
  const [state, setState] = useState<RemoteState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState<{ n: number; quiet: boolean; version?: string }>({ n: 0, quiet: false });
  const retry = useCallback(() => setAttempt((a) => ({ n: a.n + 1, quiet: false })), []);
  const refresh = useCallback(
    (version?: string) =>
      setAttempt((a) => {
        const v = version ?? a.version;
        return v === undefined ? { n: a.n + 1, quiet: true } : { n: a.n + 1, quiet: true, version: v };
      }),
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    const quiet = attempt.quiet;
    if (!quiet) setState({ status: "loading" });
    // A failed quiet refresh keeps whatever is already on screen.
    const fail = (next: RemoteState<T>) =>
      setState((prev) => (quiet && (prev.status === "ready" || prev.status === "empty") ? prev : next));

    (async () => {
      try {
        const headers: Record<string, string> = { Accept: "application/json" };
        if (getToken) {
          const token = await getToken();
          if (!token) {
            fail({ status: "error", message: "You need to sign in first", httpStatus: 401 });
            return;
          }
          headers.Authorization = `Bearer ${token}`;
        }
        const target = withVersion(url, attempt.version);
        const res = await fetch(cdn ? target : apiUrl(target), { signal: controller.signal, headers });
        const json: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          fail(
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
        fail({ status: "error", message: err instanceof Error ? err.message : "Network error" });
      }
    })();

    return () => controller.abort();
  }, [url, parse, isEmpty, getToken, cdn, attempt]);

  return { state, retry, refresh };
}
