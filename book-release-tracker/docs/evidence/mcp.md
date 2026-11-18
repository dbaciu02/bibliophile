# F12 / F13 — MCP server and MCP App

**Claim (F12):** an MCP server with read tools and one write tool, behind
Entra ID OAuth with per-tool scopes. The write tool asks for explicit
confirmation before it changes anything, a read-only token is refused on it,
and every call is audited.

**Claim (F13):** an interactive MCP App (React + TypeScript) shown inside an
MCP host, with exactly the same authorization as the tools: the app has no
token of its own, and every action it takes is a tool call checked by the
server.

How it works: [docs/mcp.md](../mcp.md).

## Before you start

```bash
npm install                    # new packages for step 7
npm run migrate:up             # migration 3: mcp_confirmations
npm run build:mcp-app          # builds the app the server serves
```

## 1. Automated tests

```bash
cd api && npx vitest run test/mcp.test.ts --reporter=verbose
cd ../mcp-app && npx vitest run --reporter=verbose
```

The API tests start a real HTTP server and talk to it with the official MCP
client SDK, plus raw HTTP where status codes and headers matter. The tests
that matter most for the spec:

- "a read-only token is refused on write tools: 403 insufficient_scope (step-up), and audited"
- "first call writes nothing and returns a confirmation question + token"
- "the token works once; replaying it is refused" / "a token is bound to its author and its user" / "an expired token is refused"
- "every tool call is audited with the caller from the token"
- "Follow asks first, writes only after Confirm, using the server's token" (app)

Paste both outputs (commit `_______`, date `_______`):

```
```

## 2. curl transcript of the endpoint

With the API running (`npm run dev:api`) and a Test Reader token copied from
the website as for `scripts/curl-evidence.sh`. For the read-only part you also
need `READONLY_TOKEN` ([entra-id-setup.md, section 8a](../entra-id-setup.md));
without it those steps are skipped and say so.

```bash
export READER_TOKEN=$(pbpaste)      # then clear the clipboard
export READONLY_TOKEN=...           # optional, see 8a
scripts/mcp-evidence.sh > docs/evidence/mcp-curl-$(git rev-parse --short HEAD).txt
```

Read the file before committing it. Check and fill in:

| Step | Expected | What you got |
| --- | --- | --- |
| Protected-resource metadata | 200, `authorization_servers` = your tenant | |
| tools/list, no token | 401, `WWW-Authenticate` with `resource_metadata=` | |
| Garbage token | 401 `invalid_token` | |
| Foreign `Host` header | 403 | |
| tools/list as Test Reader | 200, six tools | |
| add_to_watchlist without confirmation | `confirmation_required`, nothing written | |
| Made-up confirmation token | `isError`, nothing written | |
| Read-only token: search_releases | 200 | |
| Read-only token: add_to_watchlist | **403**, `error="insufficient_scope"` | |
| Read-only token: get_my_watchlist | **403**, `error="insufficient_scope"` | |

## 3. The app in a host

Three terminals: `npm run dev:api`, `npm run dev:mcp-host`, and one for the
token. Open `http://localhost:5174`, paste a Test Reader token (from the
website, as above) into the token box, press **Run show_release_calendar**.

1. The calendar appears inside the host, grouped by month. *(screenshot)*
2. Press **Follow** next to an author you don't follow yet. The question from
   the server appears with **Confirm** / **Cancel**. The host's log on the
   left shows `add_to_watchlist` → `confirmation_required`. *(screenshot)*
3. Open the website's **Watchlist** page in another tab: the author is **not**
   there yet. *(screenshot)*
4. Back in the host, press **Confirm**. The author shows **Following**, and the
   log shows the second call (`confirmationToken: [redacted]`) → `added`.
   Reload the website's Watchlist page: the author is there now. *(screenshot)*
5. Optional, with `READONLY_TOKEN`: run the host again with that token. The
   calendar still works, but **Follow** explains that the sign-in lacks
   permission to change the watchlist. *(screenshot)*

A short screen recording of steps 1–4 is a good "host recording" for the
checklist. Don't show the token box with a token in it: paste the token after
starting the recording only if the box is out of frame, or blur it.

## 4. The audit trail

In the database (as in [audit-query.md](audit-query.md)):

```sql
SELECT at, actor_subject, actor_role, action, entity_id,
       after->>'outcome' AS outcome, after->>'reason' AS reason,
       after->'arguments' AS arguments, request_id
FROM audit_log
WHERE action LIKE 'mcp.%' OR action = 'watchlist.add'
ORDER BY id DESC
LIMIT 20;
```

Paste the result:

```
```

What to look for: one `mcp.tool_call` row per call; for the follow, the
`confirmation_required` row, then a `watchlist.add` row and an `added` row
with the same user; `[redacted]` instead of the confirmation token; and (if
you did 8a) `mcp.tool_refused` rows with reason `insufficient_scope`.

## 5. Interpretation

_(In your own words: how the 403 proves a read-only token can't reach the
write tool, why the first add_to_watchlist call can't change anything, how the
audit rows tie each call to a user, and why the app needs no authorization of
its own.)_
