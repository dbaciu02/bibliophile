import { readFileSync } from "node:fs";
import { registerAppResource, RESOURCE_MIME_TYPE, RESOURCE_URI_META_KEY } from "@modelcontextprotocol/ext-apps/server";
import {
  McpServer,
  type AuthInfo,
  type CallToolResult,
  type ScopeChallengeHandler,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import { SCOPES, type Principal, type Scope } from "../auth.js";
import { writeAudit } from "../audit.js";
import { withTransaction, type Db } from "../db.js";
import { HttpError } from "../errors.js";
import type { DatePrecision } from "../lib/releaseDate.js";
import { getRelease, listReleases, type Release } from "../repositories/releases.js";
import { addItem, isWatching, listItems, upsertUser } from "../repositories/watchlist.js";
import { principalFromAuth } from "./auth.js";
import { consumeConfirmation, issueConfirmation } from "./confirmations.js";

/**
 * The MCP tools (F12) and the MCP App resource (F13).
 *
 *   tool                    kind   scope needed            role
 *   search_releases         read   Releases.Read           Reader or Curator
 *   get_release             read   Releases.Read           Reader or Curator
 *   upcoming_for_author     read   Releases.Read           Reader or Curator
 *   show_release_calendar   read   Releases.Read           Reader or Curator  (opens the MCP App)
 *   get_my_watchlist        read   Watchlist.ReadWrite     Reader or Curator
 *   add_to_watchlist        WRITE  Watchlist.ReadWrite     Reader or Curator  (needs confirmation)
 *
 * Per-tool scopes: each tool's `scopeChallenge` runs BEFORE the tool. If the
 * token lacks the scope, the SDK answers HTTP 403 with
 * `WWW-Authenticate: Bearer error="insufficient_scope", scope="…"` and the
 * tool never runs. That refusal is audited too.
 *
 * Every tool call that runs is audited ("mcp.tool_call") with the caller from
 * the validated token, the arguments (confirmation codes redacted) and the outcome.
 */

export const CALENDAR_URI = "ui://bibliophile/release-calendar.html";

export interface McpDeps {
  db: Db;
  apiAudience: string; // booktracker-api client id: scopes are api://<this>/<Scope>
  appHtml: () => string; // the built MCP App (single HTML file)
}

const ALLOWED_ROLES = ["Reader", "Curator"] as const;

// ---------------------------------------------------------------- helpers

function requestIdOf(authInfo: AuthInfo | undefined): string {
  const id = authInfo?.extra?.requestId;
  return typeof id === "string" ? id : "mcp-unknown";
}

function text(t: string): CallToolResult["content"] {
  return [{ type: "text", text: t }];
}

function fail(message: string): CallToolResult {
  return { isError: true, content: text(message) };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function humanDate(date: string, precision: DatePrecision): string {
  const [y, m, d] = date.split("-");
  if (precision === "year") return `sometime in ${y}`;
  if (precision === "month") return `${MONTHS[Number(m) - 1]} ${y}`;
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

function releaseLine(r: Release): string {
  return `• [${r.id}] ${r.title} by ${r.authors.join(", ")} (${humanDate(r.releaseDate, r.datePrecision)})`;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusMonths(isoDate: string, months: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Never put a confirmation code in the audit log. */
function redact(args: Record<string, unknown>): Record<string, unknown> {
  return "confirmationToken" in args ? { ...args, confirmationToken: "[redacted]" } : args;
}

// ---------------------------------------------------------------- server factory

/**
 * Builds one McpServer. The SDK calls this per request (stateless serving),
 * which is cheap: it only registers handlers.
 */
export function buildMcpServer(deps: McpDeps): McpServer {
  const { db, apiAudience } = deps;
  const full = (s: Scope) => `api://${apiAudience}/${s}`;

  const server = new McpServer(
    { name: "bibliophile", version: "1.0.0" },
    {
      instructions:
        "Bibliophile tracks upcoming book releases. Use search_releases or upcoming_for_author to find books, " +
        "show_release_calendar to show them visually, and get_my_watchlist / add_to_watchlist for the user's " +
        "followed authors. add_to_watchlist needs the user's explicit confirmation: call it once to get a " +
        "confirmationToken, ask the user, and only call it again with the token if they agree.",
    },
  );

  /** Per-tool scope check that also records refusals in the audit log. */
  const needsScope =
    (tool: string, scope: Scope): ScopeChallengeHandler =>
    async ({ authInfo }) => {
      const required = full(scope);
      if (!authInfo || authInfo.scopes.includes(required)) return undefined; // no token: the bearer gate handles it
      const actor = principalFromAuth(authInfo);
      if (actor) {
        await writeAudit(db, {
          actor,
          action: "mcp.tool_refused",
          entityType: "mcp_tool",
          entityId: tool,
          before: null,
          after: { reason: "insufficient_scope", required, granted: authInfo.scopes },
          requestId: requestIdOf(authInfo),
        });
      }
      // Ask for what the token already had plus what this tool needs (step-up).
      const scopes = [...new Set([...authInfo.scopes, required])] as [string, ...string[]];
      return { scopes, errorDescription: `The ${tool} tool needs the ${scope} scope` };
    };

  /**
   * Wraps a tool body: checks the role, runs it, audits the call with its
   * outcome. Tool bodies return either a result or throw an HttpError (mapped
   * to an isError result).
   */
  const run =
    <A extends Record<string, unknown>>(tool: string, body: (args: A, actor: Principal, requestId: string) => Promise<CallToolResult>) =>
    async (args: A, ctx: { http?: { authInfo?: AuthInfo } }): Promise<CallToolResult> => {
      const authInfo = ctx.http?.authInfo;
      const actor = principalFromAuth(authInfo);
      const requestId = requestIdOf(authInfo);
      if (!actor) return fail("Not signed in."); // can't happen behind the bearer gate; defensive

      let result: CallToolResult;
      if (!actor.roles.some((r) => (ALLOWED_ROLES as readonly string[]).includes(r))) {
        result = fail("Your account has no Bibliophile role (Reader or Curator). Ask an admin to assign one.");
      } else {
        try {
          result = await body(args, actor, requestId);
        } catch (err) {
          if (err instanceof HttpError) result = fail(err.message);
          else {
            // Never hand internal details (SQL, stack) to the model; log them instead.
            console.error(JSON.stringify({ level: "error", msg: "mcp tool failed", tool, requestId, err: String(err) }));
            result = fail(`Something went wrong on our side (request ${requestId}). Please try again.`);
          }
        }
      }
      const outcome =
        (result.structuredContent as { status?: string } | undefined)?.status ?? (result.isError ? "error" : "ok");
      await writeAudit(db, {
        actor,
        action: "mcp.tool_call",
        entityType: "mcp_tool",
        entityId: tool,
        before: null,
        after: { arguments: redact(args), outcome, ...(result.isError ? { error: result.content } : {}) },
        requestId,
      });
      return result;
    };

  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const isoDate = z.iso.date();

  // ---------------------------------------------------------------- read tools

  server.registerTool(
    "search_releases",
    {
      title: "Search book releases",
      description:
        "Search the Bibliophile catalog of book releases by title words, author and/or category. " +
        "By default only upcoming releases; set includePast to include books already out.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(200).optional().describe("Words in the title"),
        author: z.string().trim().min(1).max(200).optional().describe("Author name or part of it, e.g. a surname"),
        category: z.string().trim().min(1).max(100).optional().describe("e.g. Fantasy, Mystery, Poetry"),
        from: isoDate.optional().describe("Only releases on/after this date (YYYY-MM-DD)"),
        to: isoDate.optional().describe("Only releases on/before this date (YYYY-MM-DD)"),
        includePast: z.boolean().default(false),
        limit: z.number().int().min(1).max(20).default(10),
      }),
      annotations: { title: "Search book releases", ...readOnly },
      scopeChallenge: needsScope("search_releases", SCOPES.releasesRead),
    },
    run("search_releases", async (a) => {
      const from = a.from ?? (a.includePast ? undefined : todayUtc());
      const page = await listReleases(db, {
        ...(a.query ? { q: a.query } : {}),
        ...(a.author ? { author: a.author } : {}),
        ...(a.category ? { category: a.category } : {}),
        ...(from ? { from } : {}),
        ...(a.to ? { to: a.to } : {}),
        limit: a.limit,
        offset: 0,
      });
      const lines = page.items.map(releaseLine);
      return {
        content: text(lines.length ? `${lines.length} release(s):\n${lines.join("\n")}` : "No releases match."),
        structuredContent: { status: "ok", releases: page.items, more: page.nextOffset !== null },
      };
    }),
  );

  server.registerTool(
    "get_release",
    {
      title: "Get one release",
      description: "Details of one release by its id (the number in [brackets] in search results).",
      inputSchema: z.object({ id: z.number().int().positive() }),
      annotations: { title: "Get one release", ...readOnly },
      scopeChallenge: needsScope("get_release", SCOPES.releasesRead),
    },
    run("get_release", async (a) => {
      const r = await getRelease(db, a.id);
      if (!r) return fail(`No release with id ${a.id}.`);
      return {
        content: text(`${releaseLine(r)}\nCategories: ${r.categories.join(", ") || "none"}`),
        structuredContent: { status: "ok", release: r },
      };
    }),
  );

  server.registerTool(
    "upcoming_for_author",
    {
      title: "Upcoming releases by an author",
      description: "Upcoming releases by one author (a surname alone is enough).",
      inputSchema: z.object({ author: z.string().trim().min(2).max(200) }),
      annotations: { title: "Upcoming releases by an author", ...readOnly },
      scopeChallenge: needsScope("upcoming_for_author", SCOPES.releasesRead),
    },
    run("upcoming_for_author", async (a) => {
      const page = await listReleases(db, { author: a.author, from: todayUtc(), limit: 20, offset: 0 });
      const lines = page.items.map(releaseLine);
      return {
        content: text(lines.length ? lines.join("\n") : `No upcoming releases by “${a.author}” in the catalog.`),
        structuredContent: { status: "ok", author: a.author, releases: page.items },
      };
    }),
  );

  server.registerTool(
    "get_my_watchlist",
    {
      title: "My watchlist",
      description: "The authors the signed-in user follows, with how many upcoming releases each has.",
      inputSchema: z.object({}),
      annotations: { title: "My watchlist", ...readOnly },
      scopeChallenge: needsScope("get_my_watchlist", SCOPES.watchlist),
    },
    run("get_my_watchlist", async (_a, actor) => {
      const items = await listItems(db, await upsertUser(db, actor));
      const lines = items.map((i) => `• ${i.author}: ${i.upcomingCount} upcoming`);
      return {
        content: text(lines.length ? lines.join("\n") : "You aren't following any authors yet."),
        structuredContent: { status: "ok", items },
      };
    }),
  );

  // ---------------------------------------------------------------- write tool

  server.registerTool(
    "add_to_watchlist",
    {
      title: "Follow an author",
      description:
        "Add an author to the user's watchlist. REQUIRES CONFIRMATION: call without confirmationToken first; " +
        "that changes nothing and returns a token plus a question. Show the question to the user, and only if " +
        "they say yes call again with the same authorName and the confirmationToken. Tokens expire in 5 minutes.",
      inputSchema: z.object({
        authorName: z.string().trim().min(1).max(200),
        confirmationToken: z.string().min(20).max(100).optional(),
      }),
      annotations: {
        title: "Follow an author",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      scopeChallenge: needsScope("add_to_watchlist", SCOPES.watchlist),
    },
    run("add_to_watchlist", async (a, actor, requestId) => {
      const confirmArgs = { authorName: a.authorName };

      if (!a.confirmationToken) {
        // Step 1: nothing is written. Hand back a code and the question to ask.
        const userId = await upsertUser(db, actor);
        if (await isWatching(db, userId, a.authorName)) return fail(`You are already watching ${a.authorName}.`);
        const { token, expiresAt } = await issueConfirmation(db, actor.subject, "add_to_watchlist", confirmArgs);
        const question = `Add “${a.authorName}” to your Bibliophile watchlist?`;
        return {
          content: text(
            `${question} Nothing has been changed yet. If the user confirms, call add_to_watchlist again ` +
              `with authorName "${a.authorName}" and confirmationToken "${token}" (valid until ${expiresAt}).`,
          ),
          structuredContent: { status: "confirmation_required", question, confirmationToken: token, expiresAt },
        };
      }

      // Step 2: consume the code and write, in ONE transaction.
      const item = await withTransaction(db, async (client) => {
        const ok = await consumeConfirmation(client, a.confirmationToken as string, actor.subject, "add_to_watchlist", confirmArgs);
        if (!ok) {
          throw new HttpError(
            400,
            "validation_failed",
            "That confirmation token isn't valid (expired, already used, or for a different author or user). Start again without a token.",
          );
        }
        return addItem(client, actor, a.authorName, requestId);
      });
      return {
        content: text(`Now following ${item.author} (${item.upcomingCount} upcoming release(s)).`),
        structuredContent: { status: "added", item },
      };
    }),
  );

  // ---------------------------------------------------------------- MCP App (F13)

  // Registered like ext-apps' registerAppTool does it (that helper is only a
  // wrapper that sets both UI metadata keys), but directly, because its option
  // type doesn't include the SDK's per-tool `scopeChallenge` yet.
  server.registerTool(
    "show_release_calendar",
    {
      title: "Release calendar",
      description:
        "Show an interactive calendar of upcoming releases (grouped by month) that the user can browse " +
        "and follow authors from. Optional filters: author, category, months ahead.",
      inputSchema: z.object({
        author: z.string().trim().min(1).max(200).optional(),
        category: z.string().trim().min(1).max(100).optional(),
        months: z.number().int().min(1).max(12).default(3),
      }),
      annotations: { title: "Release calendar", ...readOnly },
      scopeChallenge: needsScope("show_release_calendar", SCOPES.releasesRead),
      _meta: { ui: { resourceUri: CALENDAR_URI }, [RESOURCE_URI_META_KEY]: CALENDAR_URI },
    },
    run("show_release_calendar", async (a) => {
      const from = todayUtc();
      const to = plusMonths(from, a.months);
      const page = await listReleases(db, {
        from,
        to,
        ...(a.author ? { author: a.author } : {}),
        ...(a.category ? { category: a.category } : {}),
        limit: 100,
        offset: 0,
      });
      return {
        content: text(
          `Showing ${page.items.length} release(s) from ${from} to ${to}` +
            (a.author ? ` by “${a.author}”` : "") +
            (a.category ? ` in ${a.category}` : "") +
            ` in an interactive calendar.`,
        ),
        structuredContent: {
          status: "ok",
          from,
          to,
          filters: { author: a.author ?? null, category: a.category ?? null },
          releases: page.items,
        },
      };
    }),
  );

  registerAppResource(
    server,
    "Release calendar",
    CALENDAR_URI,
    { description: "Interactive release calendar for Bibliophile", mimeType: RESOURCE_MIME_TYPE },
    async () => ({
      contents: [
        {
          uri: CALENDAR_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: deps.appHtml(),
          // The app loads book covers from Google and nothing else (CSP).
          _meta: { ui: { csp: { resourceDomains: ["https://books.google.com"] } } },
        },
      ],
    }),
  );

  return server;
}

/** Reads the built MCP App, or explains how to build it. Re-read on each request in development. */
export function loadAppHtml(path: string): () => string {
  return () => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return `<!doctype html><html><body><p>The release calendar app hasn't been built yet. Run <code>npm run build --workspace mcp-app</code>.</p></body></html>`;
    }
  };
}
