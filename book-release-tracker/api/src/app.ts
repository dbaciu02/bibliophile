import express, { type Express } from "express";
import type { TokenVerifier } from "./auth.js";
import type { Db } from "./db.js";
import { errorHandler, notFound } from "./errors.js";
import { requestId } from "./requestId.js";
import { healthRouter } from "./routes/health.js";
import { meRouter } from "./routes/me.js";
import { releasesRouter } from "./routes/releases.js";
import { watchlistRouter } from "./routes/watchlist.js";

export interface AppDeps {
  db: Db;
  gitSha: string;
  verifyToken: TokenVerifier;
}

/**
 * Builds the Express app from its dependencies. Tests call this directly with a
 * test database and a test token verifier, so nothing here reads process.env
 * or opens a port.
 */
export function createApp({ db, gitSha, verifyToken }: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // behind the CDN: use its X-Forwarded-* for client IP / protocol
  app.set("query parser", "simple"); // ?a=1 only; no nested objects from ?a[b]=1

  app.use(requestId);
  app.use(express.json({ limit: "100kb" }));

  app.use(healthRouter(db, gitSha));
  app.use("/api/releases", releasesRouter(db, verifyToken));
  app.use("/api/me/watchlist", watchlistRouter(db, verifyToken));
  app.use("/api/me", meRouter(verifyToken));
  // Later steps mount /api/books/search (4) and /api/events (6) here.

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
