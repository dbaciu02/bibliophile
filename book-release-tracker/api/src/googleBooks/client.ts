import type { z } from "zod";
import { GoogleVolume, GoogleVolumeList } from "./schema.js";

/**
 * Low-level Google Books client (F10). Every call:
 *   - has a TIMEOUT (AbortController), so a hung connection can't hold a request forever;
 *   - RETRIES a bounded number of times, only for failures that can be temporary
 *     (network error, timeout, 429, 5xx), with exponential backoff + jitter, and
 *     honours Retry-After on 429 (capped);
 *   - is skipped entirely while the CIRCUIT BREAKER is open (after several
 *     failures in a row), so a dead provider fails fast instead of slowing every request;
 *   - VALIDATES the JSON with zod before anyone uses it.
 *
 * The API key comes from config (the host's secret store in production). It is
 * sent as the documented `key` query parameter, so request URLs are never
 * logged or put in error messages.
 *
 * Caching lives one layer up (cachedBooks.ts); this file only talks to Google.
 */

export type FetchFn = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;

export interface GoogleBooksOptions {
  apiKey?: string | undefined; // optional in dev: Google allows a small anonymous quota
  fetch?: FetchFn;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number; // retries AFTER the first attempt
  backoffMs?: number; // first backoff; doubles each retry
  maxRetryAfterMs?: number; // cap on a 429's Retry-After
  breakerThreshold?: number; // consecutive failed calls before opening
  breakerCooldownMs?: number; // how long it stays open
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Why a call failed. Callers turn these into 404 / 503 for the client. */
export class GoogleBooksError extends Error {
  constructor(
    readonly kind: "not_found" | "bad_request" | "unavailable" | "invalid_response" | "circuit_open",
    message: string,
    readonly attempts: number,
  ) {
    super(message);
    this.name = "GoogleBooksError";
  }
}

class RetryableError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export interface GoogleBooksClient {
  search(query: string, maxResults: number): Promise<GoogleVolumeList>;
  getVolume(volumeId: string): Promise<GoogleVolume>;
  /** For tests and /healthz-style diagnostics. */
  breakerState(): "closed" | "open";
}

export function createGoogleBooksClient(opts: GoogleBooksOptions = {}): GoogleBooksClient {
  const doFetch: FetchFn = opts.fetch ?? ((url, init) => fetch(url, init));
  const baseUrl = opts.baseUrl ?? "https://www.googleapis.com/books/v1";
  const timeoutMs = opts.timeoutMs ?? 3_000;
  const maxRetries = opts.maxRetries ?? 2;
  const backoffMs = opts.backoffMs ?? 250;
  const maxRetryAfterMs = opts.maxRetryAfterMs ?? 2_000;
  const breakerThreshold = opts.breakerThreshold ?? 3;
  const breakerCooldownMs = opts.breakerCooldownMs ?? 30_000;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let consecutiveFailures = 0;
  let openUntil = 0;

  const breakerState = () => (now() < openUntil ? "open" : "closed");

  async function attemptOnce(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    } catch (err) {
      throw new RetryableError(controller.signal.aborted ? `timed out after ${timeoutMs} ms` : "network error");
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) {
      try {
        return await res.json();
      } catch {
        throw new GoogleBooksError("invalid_response", "Google Books returned a body that isn't JSON", 0);
      }
    }
    if (res.status === 429) {
      const header = Number(res.headers.get("retry-after"));
      const retryAfterMs = Number.isFinite(header) && header > 0 ? Math.min(header * 1000, maxRetryAfterMs) : undefined;
      throw new RetryableError("rate limited by Google (429)", retryAfterMs);
    }
    if (res.status >= 500) throw new RetryableError(`Google Books returned ${res.status}`);
    if (res.status === 404) throw new GoogleBooksError("not_found", "Google Books has no such volume", 0);
    // Other 4xx (bad key, bad query, quota misconfigured): retrying won't help.
    throw new GoogleBooksError("bad_request", `Google Books rejected the request (${res.status})`, 0);
  }

  async function call<T>(path: string, params: Record<string, string>, schema: z.ZodType<T>): Promise<T> {
    if (breakerState() === "open") {
      throw new GoogleBooksError("circuit_open", "Google Books is marked unavailable; not calling it for now", 0);
    }

    const query = new URLSearchParams(params);
    if (opts.apiKey) query.set("key", opts.apiKey);
    const url = `${baseUrl}${path}?${query.toString()}`;

    let lastError = "unknown error";
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const json = await attemptOnce(url);
        const parsed = schema.safeParse(json);
        if (!parsed.success) {
          throw new GoogleBooksError("invalid_response", "Google Books response didn't match the expected shape", attempt);
        }
        consecutiveFailures = 0;
        return parsed.data;
      } catch (err) {
        if (err instanceof GoogleBooksError) {
          // A definite answer (404, bad request) means Google is up: don't count it against the breaker.
          if (err.kind === "not_found" || err.kind === "bad_request") {
            consecutiveFailures = 0;
            throw new GoogleBooksError(err.kind, err.message, attempt);
          }
          recordFailure();
          throw new GoogleBooksError(err.kind, err.message, attempt);
        }
        const retryable = err as RetryableError;
        lastError = retryable.message;
        if (attempt > maxRetries) break;
        // Exponential backoff with jitter: ~250ms, ~500ms, ... unless Google said how long.
        const delay = retryable.retryAfterMs ?? backoffMs * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5);
        await sleep(delay);
      }
    }
    recordFailure();
    throw new GoogleBooksError("unavailable", `Google Books unavailable: ${lastError}`, maxRetries + 1);
  }

  function recordFailure(): void {
    consecutiveFailures += 1;
    if (consecutiveFailures >= breakerThreshold) {
      openUntil = now() + breakerCooldownMs;
      consecutiveFailures = 0;
    }
  }

  return {
    search: (q, maxResults) =>
      call("/volumes", { q, maxResults: String(maxResults), printType: "books" }, GoogleVolumeList),
    getVolume: (id) => call(`/volumes/${encodeURIComponent(id)}`, {}, GoogleVolume),
    breakerState,
  };
}
