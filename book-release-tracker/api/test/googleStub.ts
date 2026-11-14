import type { FetchFn } from "../src/googleBooks/client.js";

/**
 * A fake Google Books for tests. Each call to the returned fetch takes the next
 * scripted behaviour; when the script runs out, the last behaviour repeats.
 * Nothing here touches the network.
 */
export type Behaviour =
  | { ok: unknown } // 200 with this JSON body
  | { status: number; body?: unknown; retryAfter?: number }
  | { hang: true } // never answers (until aborted by the client's timeout)
  | { networkError: true }
  | { notJson: true }; // 200 with an HTML body

export interface GoogleStub {
  fetch: FetchFn;
  calls: string[]; // every URL requested, in order
}

export function stubGoogle(...script: Behaviour[]): GoogleStub {
  const calls: string[] = [];
  let i = 0;

  const fetch: FetchFn = (url, init) => {
    calls.push(url);
    const b = script[Math.min(i, script.length - 1)];
    i += 1;
    if (!b) throw new Error("stubGoogle needs at least one behaviour");

    if ("hang" in b) {
      return new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    if ("networkError" in b) return Promise.reject(new TypeError("fetch failed"));
    if ("notJson" in b) {
      return Promise.resolve(new Response("<html>oops</html>", { status: 200, headers: { "content-type": "text/html" } }));
    }
    if ("ok" in b) return Promise.resolve(Response.json(b.ok));
    const headers: Record<string, string> = {};
    if (b.retryAfter !== undefined) headers["retry-after"] = String(b.retryAfter);
    return Promise.resolve(Response.json(b.body ?? { error: { code: b.status } }, { status: b.status, headers }));
  };

  return { fetch, calls };
}

/** A realistic (trimmed) Google Books volume. */
export function volume(id: string, overrides: Record<string, unknown> = {}) {
  return {
    kind: "books#volume",
    id,
    volumeInfo: {
      title: `Synthetic Book ${id}`,
      authors: ["Ana Synthetic"],
      publishedDate: "2027-03",
      categories: ["Fiction"],
      imageLinks: { thumbnail: `http://books.google.com/books/content?id=${id}&printsec=frontcover&img=1&zoom=1` },
      ...overrides,
    },
  };
}

export const searchResult = (...vols: ReturnType<typeof volume>[]) => ({
  kind: "books#volumes",
  totalItems: vols.length,
  ...(vols.length > 0 ? { items: vols } : {}),
});

/** No waiting in tests: backoff sleeps resolve immediately. */
export const noSleep = async () => {};
