import {
  getOAuthProtectedResourceMetadataUrl,
  hostHeaderValidation,
  mcpAuthMetadataRouter,
  requireBearerAuth,
} from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";
import { Router, type RequestHandler } from "express";
import { SCOPES, type TokenVerifier } from "../auth.js";
import type { Db } from "../db.js";
import { rateLimit } from "../rateLimit.js";
import { fullScope, mcpTokenVerifier, principalFromAuth } from "./auth.js";
import { buildMcpServer } from "./tools.js";
import { log } from "../log.js";

/**
 * Mounts the MCP server (Streamable HTTP) at /mcp, plus the OAuth discovery
 * documents MCP hosts use to find out how to sign in (F12).
 *
 *   GET  /.well-known/oauth-protected-resource/mcp   RFC 9728: "this resource trusts Entra ID; these scopes"
 *   GET  /.well-known/oauth-authorization-server     RFC 8414 pointer to Entra, for older clients
 *   POST /mcp                                         MCP requests; Bearer token required
 *
 * Request path:  Host check -> Bearer token check (401 + resource_metadata on
 * failure) -> MCP SDK -> per-tool scope check (403 insufficient_scope) -> tool.
 */
export interface McpOptions {
  db: Db;
  verify: TokenVerifier;
  apiAudience: string; // booktracker-api client id
  issuer: string; // Entra v2 issuer of this tenant
  publicBaseUrl: URL; // e.g. https://bibliophile.example.org (no trailing path)
  appHtml: () => string;
}

export function mcpRouter(opts: McpOptions): Router {
  const router = Router();
  const resourceUrl = new URL("/mcp", opts.publicBaseUrl);
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resourceUrl);
  const allScopes = [SCOPES.releasesRead, SCOPES.watchlist].map((s) => fullScope(opts.apiAudience, s));

  // Discovery. The authorization server is the same Entra ID tenant the web app uses.
  const tenantBase = opts.issuer.replace(/\/v2\.0$/, "");
  router.use(
    mcpAuthMetadataRouter({
      resourceServerUrl: resourceUrl,
      resourceName: "Bibliophile (book release tracker)",
      scopesSupported: allScopes,
      oauthMetadata: {
        issuer: opts.issuer,
        authorization_endpoint: `${tenantBase}/oauth2/v2.0/authorize`,
        token_endpoint: `${tenantBase}/oauth2/v2.0/token`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        scopes_supported: ["openid", "profile", "offline_access", ...allScopes],
      },
    }),
  );

  const handler = createMcpHandler(() => buildMcpServer({ db: opts.db, apiAudience: opts.apiAudience, appHtml: opts.appHtml }), {
    legacy: "stateless", // also serve 2025-era MCP clients
    onerror: (err) => log("error", "mcp error", { err: String(err) }),
  });
  const serveMcp = toNodeHandler(handler);

  // The audit log ties each tool call to its HTTP request id.
  const stampRequestId: RequestHandler = (req, res, next) => {
    if (req.auth) req.auth.extra = { ...req.auth.extra, requestId: res.locals.requestId as string };
    next();
  };

  router.all(
    "/mcp",
    // DNS-rebinding protection: only answer for our own host names.
    hostHeaderValidation(["localhost", "127.0.0.1", "[::1]", opts.publicBaseUrl.hostname]),
    requireBearerAuth({ verifier: mcpTokenVerifier(opts.verify, opts.apiAudience), resourceMetadataUrl }),
    stampRequestId,
    // S1: per-user limit on MCP calls (an assistant can loop on tools).
    rateLimit({
      name: "mcp",
      limit: 120,
      windowMs: 60_000,
      key: (req) => principalFromAuth((req as { auth?: AuthInfo }).auth)?.subject,
    }),
    (req, res) => {
      // Never cache MCP responses (D6). The SDK sets "no-cache" on SSE replies,
      // which still lets a shared cache store them, so pin the header to no-store.
      const setHeader = res.setHeader.bind(res);
      res.setHeader = (name, value) =>
        name.toLowerCase() === "cache-control" ? setHeader(name, "no-store") : setHeader(name, value);
      res.setHeader("Cache-Control", "no-store");
      void serveMcp(req, res, req.body);
    },
  );

  return router;
}
