import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

/**
 * The ONE JSON error shape every route returns (requirement F3):
 *
 *   { "error": { "code": "not_found", "message": "...", "requestId": "...", "details"?: [...] } }
 *
 * `code` is stable and machine-readable; `message` is for humans; `requestId`
 * matches the X-Request-Id response header and the server log line.
 */
export type ErrorCode =
  | "validation_failed" // 400
  | "invalid_json" // 400
  | "unauthenticated" // 401
  | "forbidden" // 403
  | "not_found" // 404
  | "conflict" // 409
  | "rate_limited" // 429
  | "upstream_unavailable" // 503
  | "internal"; // 500

export interface ErrorDetail {
  path: string;
  message: string;
}

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    details?: ErrorDetail[];
  };
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, "not_found", `No route for ${req.method} ${req.path}`));
};

function isJsonParseError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "type" in err &&
    (err as { type: unknown }).type === "entity.parse.failed"
  );
}

export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  const requestId = res.locals.requestId as string;
  let status: number;
  let body: ErrorBody["error"];

  if (err instanceof HttpError) {
    status = err.status;
    body = { code: err.code, message: err.message, requestId };
    if (err.details) body.details = err.details;
  } else if (err instanceof ZodError) {
    status = 400;
    body = {
      code: "validation_failed",
      message: "Request failed validation",
      requestId,
      details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    };
  } else if (isJsonParseError(err)) {
    status = 400;
    body = { code: "invalid_json", message: "Request body is not valid JSON", requestId };
  } else {
    // Unexpected: log the real error server-side, never send internals to the client.
    status = 500;
    body = { code: "internal", message: "Internal server error", requestId };
    console.error(JSON.stringify({ level: "error", requestId, path: req.path, err: String(err) }));
  }

  res.status(status).json({ error: body } satisfies ErrorBody);
};
