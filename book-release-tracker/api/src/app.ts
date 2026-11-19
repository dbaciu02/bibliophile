import express, { type Express } from "express";
import type { TokenVerifier } from "./auth.js";
import type { Db } from "./db.js";
import { createBooksService, type BooksService } from "./googleBooks/cachedBooks.js";
import { createGoogleBooksClient } from "./googleBooks/client.js";
import { errorHandler, notFound } from "./errors.js";
import type { EventHub } from "./events/hub.js";
import { mcpRouter, type McpOptions } from "./mcp/router.js";
import { requestId } from "./requestId.js";
import { cors, securityHeaders } from "./security.js";
import { booksRouter } from "./routes/books.js";
import { eventsRouter } from "./routes/events.js";
import { healthRouter } from "./routes/health.js";
import { importRouter } from "./routes/import.js";
import { meRouter } from "./routes/me.js";
import { releasesRouter } from "./routes/releases.js";
import { watchlistRouter } from "./routes/watchlist.js";

export interface AppDeps {
  db: Db;
  gitSha: string;
  verifyToken: TokenVerifier;
  /** Google Books behind the cache. Tests pass one with a stubbed fetch. */
  books?: BooksService;
  /** Live-update hub for GET /api/events. Without it the route is not mounted. */
  events?: EventHub;
  /** Tests shorten the SSE heartbeat. */
  eventsHeartbeatMs?: number;
  /** Exact browser origins allowed to call the API (D7). Default: none. */
  corsOrigins?: readonly string[];
  /** MCP server settings. Without them /mcp is not mounted. */
  mcp?: Omit<McpOptions, "db" | "verify">;
}

/**
 * Builds the Express app from its dependencies. Tests call this directly with a
 * test database and a test token verifier, so nothing here reads process.env
 * or opens a port.
 */
export function createApp({ db, gitSha, verifyToken, books, events, eventsHeartbeatMs, corsOrigins = [], mcp }: AppDeps): Express {
  const booksService = books ?? createBooksService(db, createGoogleBooksClient());
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // behind the host's load balancer: use its X-Forwarded-* for client IP / protocol
  app.set("query parser", "simple"); // ?a=1 only; no nested objects from ?a[b]=1

  app.use(requestId);
  app.use(securityHeaders);
  app.use(cors(corsOrigins));
  app.use(express.json({ limit: "100kb" }));

  app.use(healthRouter(db, gitSha));
  app.use("/api/releases/import", importRouter(db, verifyToken, booksService));
  app.use("/api/releases", releasesRouter(db, verifyToken));
  app.use("/api/books", booksRouter(db, verifyToken, booksService));
  app.use("/api/me/watchlist", watchlistRouter(db, verifyToken));
  app.use("/api/me", meRouter(verifyToken));
  if (events) {
    app.use("/api/events", eventsRouter(events, eventsHeartbeatMs === undefined ? {} : { heartbeatMs: eventsHeartbeatMs }));
  }

  if (mcp) app.use(mcpRouter({ ...mcp, db, verify: verifyToken }));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
