import { apiUrl } from "./base";

/**
 * One-off API calls that change data (POST/DELETE). Reads go through
 * useRemote instead. Always resolves — never throws — so every caller has to
 * handle the failure case explicitly.
 */

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number | null; message: string; requestId?: string; details?: FieldError[] };

/** One invalid field from a 400: `path` is the field name, e.g. "title" or "authors.0". */
export interface FieldError {
  path: string;
  message: string;
}

interface ErrorBody {
  error: { code: string; message: string; requestId: string; details?: unknown };
}

function fieldErrors(v: unknown): FieldError[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter(
    (d): d is FieldError => typeof d === "object" && d !== null && typeof d.path === "string" && typeof d.message === "string",
  );
  return out.length > 0 ? out : undefined;
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
    res = await fetch(apiUrl(path), init);
  } catch {
    return { ok: false, status: null, message: "Couldn’t reach the server. Check your connection and try again." };
  }

  const json: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (!isErrorBody(json)) return { ok: false, status: res.status, message: `Request failed (${res.status})` };
    const details = fieldErrors(json.error.details);
    return {
      ok: false,
      status: res.status,
      message: json.error.message,
      requestId: json.error.requestId,
      ...(details ? { details } : {}),
    };
  }
  try {
    return { ok: true, status: res.status, data: opts.parse ? opts.parse(json) : (json as T) };
  } catch {
    return { ok: false, status: res.status, message: "The server sent an unexpected response" };
  }
}
