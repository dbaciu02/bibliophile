import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

const SAFE_ID = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Gives every request an id, returned in X-Request-Id and in every error body.
 * An incoming id (e.g. from the CDN) is reused only if it looks safe, so a
 * client can't inject arbitrary text into our logs.
 */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get("x-request-id");
  const id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.locals.requestId = id;
  res.set("X-Request-Id", id);
  next();
};
