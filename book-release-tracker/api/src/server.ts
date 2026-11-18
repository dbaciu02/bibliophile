import path from "node:path";
import { createApp } from "./app.js";
import { createTokenVerifier, entraVerifierOptions, rejectAllVerifier } from "./auth.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db.js";
import { createEventHub } from "./events/hub.js";
import { loadAppHtml } from "./mcp/tools.js";
import { createBooksService } from "./googleBooks/cachedBooks.js";
import { createGoogleBooksClient } from "./googleBooks/client.js";

const config = loadConfig();
const db = createDb(config.DATABASE_URL);

// Until Entra ID is set up (docs/entra-id-setup.md), protected routes simply
// return 401 in development. Production refuses to start without it (config.ts).
const verifyToken =
  config.ENTRA_TENANT_ID && config.ENTRA_API_CLIENT_ID
    ? createTokenVerifier(entraVerifierOptions(config.ENTRA_TENANT_ID, config.ENTRA_API_CLIENT_ID))
    : rejectAllVerifier;
if (verifyToken === rejectAllVerifier) {
  console.warn(JSON.stringify({ level: "warn", msg: "Entra ID not configured: all protected routes will return 401" }));
}

if (!config.GOOGLE_BOOKS_API_KEY) {
  console.warn(JSON.stringify({ level: "warn", msg: "GOOGLE_BOOKS_API_KEY not set: using Google's small anonymous quota" }));
}
if (config.GOOGLE_BOOKS_BASE_URL) {
  console.warn(JSON.stringify({ level: "warn", msg: "GOOGLE_BOOKS_BASE_URL overridden (outage simulation?)", baseUrl: config.GOOGLE_BOOKS_BASE_URL }));
}
const books = createBooksService(db, createGoogleBooksClient({
    apiKey: config.GOOGLE_BOOKS_API_KEY,
    ...(config.GOOGLE_BOOKS_BASE_URL ? { baseUrl: config.GOOGLE_BOOKS_BASE_URL } : {}),
  }));

const events = await createEventHub(db, config.DATABASE_URL);

// MCP server at /mcp (F12/F13): needs Entra to be configured, like every protected route.
const mcp =
  config.ENTRA_TENANT_ID && config.ENTRA_API_CLIENT_ID
    ? {
        apiAudience: config.ENTRA_API_CLIENT_ID,
        issuer: `https://login.microsoftonline.com/${config.ENTRA_TENANT_ID}/v2.0`,
        publicBaseUrl: new URL(config.PUBLIC_BASE_URL),
        appHtml: loadAppHtml(path.resolve(config.MCP_APP_HTML)),
      }
    : undefined;

const app = createApp({ db, gitSha: config.GIT_SHA, verifyToken, books, events, ...(mcp ? { mcp } : {}) });

const server = app.listen(config.PORT, () => {
  console.log(JSON.stringify({ level: "info", msg: "api listening", port: config.PORT, commit: config.GIT_SHA }));
});

// Graceful shutdown: finish in-flight requests, then close DB connections.
// Hosts send SIGTERM on every redeploy.
function shutdown(signal: string): void {
  console.log(JSON.stringify({ level: "info", msg: "shutting down", signal }));
  // Open SSE streams never finish on their own, so close them explicitly.
  server.closeAllConnections();
  server.close(() => {
    void events.close().then(() => db.end()).then(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
