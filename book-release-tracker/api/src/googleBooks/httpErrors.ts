import { HttpError } from "../errors.js";
import { GoogleBooksError } from "./client.js";

/** Turns a Google Books failure into the API's standard error response. */
export function toHttpError(err: unknown): unknown {
  if (!(err instanceof GoogleBooksError)) return err;
  switch (err.kind) {
    case "not_found":
      return new HttpError(404, "not_found", "Google Books has no volume with that id");
    case "bad_request":
    case "unavailable":
    case "invalid_response":
    case "circuit_open":
      // Logged server-side with the real reason; the client gets a plain 503.
      console.warn(JSON.stringify({ level: "warn", msg: "google books failure", kind: err.kind, attempts: err.attempts, detail: err.message }));
      return new HttpError(
        503,
        "upstream_unavailable",
        "Google Books is unavailable right now and nothing is cached for this request. Try again later.",
      );
  }
}
