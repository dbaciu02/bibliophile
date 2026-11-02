import express, { type Express } from "express";
import type { Db } from "./db.js";
import { errorHandler, notFound } from "./errors.js";
import { requestId } from "./requestId.js";
import { healthRouter } from "./routes/health.js";

export interface AppDeps {
  db: Db;
  gitSha: string;
}

/**
 * Builds the Express app from its dependencies. Tests call this directly with a
 * test database, so nothing here reads process.env or opens a port.
 */
export function createApp({ db, gitSha }: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // behind the CDN: use its X-Forwarded-* for client IP / protocol

  app.use(requestId);
  app.use(express.json({ limit: "100kb" }));

  app.use(healthRouter(db, gitSha));
  // Later steps mount /api/releases, /api/me/watchlist, /api/events here.

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
