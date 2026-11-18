# MCP server and MCP App (F12, F13)

Bibliophile exposes its catalog and the signed-in user's watchlist to AI
assistants through the Model Context Protocol, at **`POST /mcp`** on the API
(Streamable HTTP, stateless). The same server ships one MCP App: an
interactive release calendar that hosts render in a sandboxed iframe.

Code: `api/src/mcp/` (server), `mcp-app/` (the app), `api/test/mcp.test.ts`
and `mcp-app/src/CalendarView.test.tsx` (tests).

## Tools

| Tool | Kind | Scope required | What it does |
| --- | --- | --- | --- |
| `search_releases` | read | `Releases.Read` | Search by title words, author, category, date range; upcoming only unless `includePast` |
| `get_release` | read | `Releases.Read` | One release by id |
| `upcoming_for_author` | read | `Releases.Read` | Future releases by one author |
| `get_my_watchlist` | read (own data) | `Watchlist.ReadWrite` | The caller's followed authors with upcoming counts |
| `show_release_calendar` | read + UI | `Releases.Read` | Releases grouped by month; opens the MCP App |
| `add_to_watchlist` | **write** | `Watchlist.ReadWrite` | Follow an author, **only after confirmation** (below) |

Every tool also requires the app role **Reader** or **Curator** in the token;
a signed-in user without a role gets an error result and no data. Read tools
are annotated `readOnlyHint: true`; `add_to_watchlist` is not.

## Authorization

The MCP endpoint is an OAuth 2.1 protected resource; Entra ID is the
authorization server. Nothing is reachable without a valid token.

1. **Discovery (RFC 9728).** A request without a token gets
   `401` with
   `WWW-Authenticate: Bearer error="invalid_token", resource_metadata="<base>/.well-known/oauth-protected-resource/mcp"`.
   That document names the Entra tenant as the authorization server and lists
   the scopes as full names (`api://<api-client-id>/Releases.Read`, …).
2. **Token checks.** The same verifier as the REST API (`api/src/auth.ts`):
   RS256 signature against Entra's keys, issuer, audience (the API's client
   id), expiry. Any failure is `401 invalid_token`.
3. **Per-tool scopes.** Each tool declares the scope it needs. A token without
   it is refused **before the tool runs** with
   `403` and `WWW-Authenticate: Bearer error="insufficient_scope", scope="<what you have> <what is needed>"`
   so a host can ask the user to sign in again with more permission
   (step-up). The refusal is audited (`mcp.tool_refused`).
4. **Roles.** Checked inside every tool (Reader or Curator).
5. **Host header check.** Only `localhost`, `127.0.0.1`, `[::1]` and the
   `PUBLIC_BASE_URL` host are accepted, against DNS-rebinding attacks.
6. **No caching.** Every `/mcp` response is `Cache-Control: no-store`.

The user is always taken from the validated token, never from tool arguments,
so one user can't read or change another's watchlist through MCP.

## The write tool: explicit confirmation

`add_to_watchlist` never writes on the first call.

1. Called with only `authorName`, it checks the author isn't already followed,
   stores a **one-time confirmation token** (32 random bytes, valid 5 minutes)
   bound to *this user, this tool and these exact arguments*, and returns
   `status: "confirmation_required"` with a question for the user. Nothing in
   the watchlist changes.
2. Only when the user agrees does the assistant (or the app's Confirm button)
   call again with `confirmationToken`. In one transaction the server marks
   the token used (only if unused, unexpired, same user, same author) and adds
   the author. A replayed, expired, or mismatched token is refused.

The model can't skip step 1: a token is only ever created by the server, and
only by a call that changed nothing.

## Audit

Every tool call writes one `audit_log` row (`mcp.tool_call`) with the user
(from the token), role, tool name, arguments (confirmation tokens replaced by
`[redacted]`), outcome (`ok`, `confirmation_required`, `added`, `error`) and
the request id. A successful follow additionally writes the same
`watchlist.add` row the website writes, in the same transaction. Scope
refusals write `mcp.tool_refused`. The audit table is append-only (database
trigger).

Unexpected errors are logged on the server; the model only sees
"Something went wrong on our side (request <id>)", never SQL or stack traces.

## The MCP App (release calendar)

- Built from `mcp-app/` (React + TypeScript, strict) into one self-contained
  file, `mcp-app/dist/release-calendar.html`, which the API serves as the
  resource `ui://bibliophile/release-calendar.html`
  (`text/html;profile=mcp-app`).
- `show_release_calendar` points to it through `_meta.ui.resourceUri`, so a
  host that supports MCP Apps shows the calendar instead of plain text.
- **Same authorization as the tools:** the app has no token and makes no
  network calls of its own. Changing the range or following an author is a
  tool call that the host sends to the server with the user's token, through
  the same scope, role, confirmation and audit checks. A read-only token can
  browse the calendar but Follow is refused (the app explains which
  permission is missing).
- Follow always shows the server's confirmation question with Confirm /
  Cancel; only Confirm sends the second call.
- The resource declares a Content-Security-Policy allowance for book covers
  from `https://books.google.com` only.
- Every tool result is checked with zod before it is shown. Keyboard: focus
  moves to Confirm when the question opens, Escape cancels, and focus goes
  back to the Follow button. axe: 0 violations, light and dark.

## Trying it locally

```bash
npm run build:mcp-app          # builds mcp-app/dist/release-calendar.html
npm run dev:api                # MCP at http://localhost:3000/mcp (needs Entra configured)
npm run dev:mcp-host           # dev host at http://localhost:5174
```

The **dev host** (`mcp-app/dev-host/`) is a minimal MCP Apps host for local
testing: paste an access token (copied from the website, as for
`scripts/curl-evidence.sh`), press *Run*. It discovers the app from the tool
list, reads the `ui://` resource, renders it in an iframe with
`sandbox="allow-scripts"` and the resource's CSP, and passes the app's tool
calls through to `/mcp`, logging each one (confirmation tokens redacted). It
is a test tool and is never deployed.

`scripts/mcp-evidence.sh` produces a `curl -i` transcript of the endpoint,
including the 401, the 403 for a read-only token, and the confirmation step.

## Connecting a real assistant (after deployment)

Hosts such as Claude or VS Code need the server on a public HTTPS URL, so this
comes with deployment (build step 8). Entra ID doesn't support dynamic
client registration, so the host gets a **pre-registered client**: an app
registration with the host's redirect URI and delegated permissions for the
API's scopes (see [entra-id-setup.md](entra-id-setup.md), section 8).

## Honest limits

- Stateless transport: no server-initiated notifications over MCP (the
  website's live updates use SSE instead). A `GET /mcp` is answered `405`,
  as the spec allows for servers without a standalone stream.
- The bundled app is ~460 kB (~130 kB gzipped) because it includes React and
  the MCP Apps SDK; it is fetched once per conversation by the host.
