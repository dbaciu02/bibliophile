/**
 * One-off API calls that change data (POST/DELETE). Reads go through
 * useRemote instead. Always resolves — never throws — so every caller has to
 * handle the failure case explicitly.
 */

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number | null; message: string; requestId?: string };

interface ErrorBody {
  error: { code: string; message: string; requestId: string };
}

function isErrorBody(v: unknown): v is ErrorBody {
  if (typeof v !== "object" || v === null || !("error" in v)) return false;
  const e = (v as { error: unknown }).error;
  return typeof e === "object" && e !== null && "message" in e && "requestId" in e;
}

export async function apiRequest<T>(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  opts: { token: string | null; body?: unknown; parse?: (json: unknown) => T },
): Promise<ApiResult<T>> {
  if (!opts.token) return { ok: false, status: 401, message: "You need to sign in first" };

  const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${opts.token}` };
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    return { ok: false, status: null, message: "Couldn’t reach the server. Check your connection and try again." };
  }

  const json: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    return isErrorBody(json)
      ? { ok: false, status: res.status, message: json.error.message, requestId: json.error.requestId }
      : { ok: false, status: res.status, message: `Request failed (${res.status})` };
  }
  try {
    return { ok: true, status: res.status, data: opts.parse ? opts.parse(json) : (json as T) };
  } catch {
    return { ok: false, status: res.status, message: "The server sent an unexpected response" };
  }
}
