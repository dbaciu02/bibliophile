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

Paste both outputs (commit `_______`, date `11-17-2026`):

```

 RUN  v5.1.0 /Users/dorabaciu/Desktop/DePaul/Classes/CSC 436 Web Applications/bibliophile/book-release-tracker/api

 ✓ test/mcp.test.ts > MCP authorization metadata (RFC 9728) > publishes protected-resource metadata pointing at Entra ID 29ms
 ✓ test/mcp.test.ts > MCP authorization metadata (RFC 9728) > no token -> 401 with WWW-Authenticate naming the metadata URL 14ms
 ✓ test/mcp.test.ts > MCP authorization metadata (RFC 9728) > bad signature, wrong audience and expired tokens -> 401 invalid_token 17ms
 ✓ test/mcp.test.ts > MCP authorization metadata (RFC 9728) > rejects a foreign Host header (DNS-rebinding guard) 4ms
 ✓ test/mcp.test.ts > MCP tools > lists six tools; only add_to_watchlist is not read-only 20ms
 ✓ test/mcp.test.ts > MCP tools > search_releases defaults to upcoming only and returns structured releases 20ms
 ✓ test/mcp.test.ts > MCP tools > search_releases validates input (bad date -> error, nothing thrown at the transport) 7ms
 ✓ test/mcp.test.ts > MCP tools > get_release on an unknown id -> isError with a plain message 12ms
 ✓ test/mcp.test.ts > MCP tools > upcoming_for_author returns only future books by that author 13ms
 ✓ test/mcp.test.ts > MCP tools > every tool call is audited with the caller from the token 6ms
 ✓ test/mcp.test.ts > add_to_watchlist: explicit confirmation before any write > first call writes nothing and returns a confirmation question + token 29ms
 ✓ test/mcp.test.ts > add_to_watchlist: explicit confirmation before any write > the token works once; replaying it is refused 76ms
 ✓ test/mcp.test.ts > add_to_watchlist: explicit confirmation before any write > already-followed author -> error, no token issued 16ms
 ✓ test/mcp.test.ts > add_to_watchlist: explicit confirmation before any write > a token is bound to its author and its user 89ms
 ✓ test/mcp.test.ts > add_to_watchlist: explicit confirmation before any write > an expired token is refused 42ms
 ✓ test/mcp.test.ts > add_to_watchlist: explicit confirmation before any write > the write is audited twice: the watchlist change and the tool call (token redacted) 5ms
 ✓ test/mcp.test.ts > add_to_watchlist: explicit confirmation before any write > get_my_watchlist shows only the caller's own items 22ms
 ✓ test/mcp.test.ts > scopes and roles > a read-only token is refused on write tools: 403 insufficient_scope (step-up), and audited 29ms
 ✓ test/mcp.test.ts > scopes and roles > a read-only token can still read 16ms
 ✓ test/mcp.test.ts > scopes and roles > a token with only Watchlist.ReadWrite is refused on catalog tools 50ms
 ✓ test/mcp.test.ts > scopes and roles > a signed-in user with no app role gets an isError result and no data 20ms
 ✓ test/mcp.test.ts > MCP App (F13 resource) > show_release_calendar links to the ui:// resource (both meta keys) 26ms
 ✓ test/mcp.test.ts > MCP App (F13 resource) > serves the app HTML with the MCP App mime type and a tight CSP 18ms
 ✓ test/mcp.test.ts > MCP App (F13 resource) > responses are never cached 5ms

 Test Files  1 passed (1)
      Tests  24 passed (24)
   Start at  22:45:37
   Duration  2.08s (tests 64%, import 30%, transform 4%, setup 1%)


 RUN  v5.1.0 /Users/dorabaciu/Desktop/DePaul/Classes/CSC 436 Web Applications/bibliophile/book-release-tracker/mcp-app

 ✓ src/CalendarView.test.tsx > CalendarView > groups by month, with a year-only group after that year's months 145ms
 ✓ src/CalendarView.test.tsx > CalendarView > Follow asks first, writes only after Confirm, using the server's token 91ms
 ✓ src/CalendarView.test.tsx > CalendarView > Cancel (or Escape) sends nothing more 94ms
 ✓ src/CalendarView.test.tsx > CalendarView > shows the server's error message (e.g. already following) 26ms
 ✓ src/CalendarView.test.tsx > CalendarView > a network failure becomes an error message, not a crash 26ms
 ✓ src/CalendarView.test.tsx > CalendarView > a scope refusal (403 insufficient_scope) explains which permission is missing 23ms
 ✓ src/CalendarView.test.tsx > CalendarView > changing the range asks for a new calendar 20ms
 ✓ src/CalendarView.test.tsx > CalendarView > empty range -> a helpful empty state 3ms
 ✓ src/CalendarView.test.tsx > parseResult > passes the tool's own error text through 1ms
 ✓ src/CalendarView.test.tsx > parseResult > rejects a reply with the wrong shape 1ms
 ✓ src/CalendarView.test.tsx > parseResult > accepts a real calendar reply 2ms

 Test Files  1 passed (1)
      Tests  11 passed (11)
   Start at  22:45:40
   Duration  2.01s (environment 59%, tests 23%, setup 10%, import 6%, transform 1%)
```

## 2. curl transcript of the endpoint

With the API running (`npm run dev:api`) and a Test Reader token copied from
the website as for `scripts/curl-evidence.sh`. For the read-only part you also
need `READONLY_TOKEN` ([entra-id-setup.md, section 8a](../entra-id-setup.md));
without it those steps are skipped and say so.

```bash
export READER_TOKEN=$(pbpaste)
scripts/mcp-evidence.sh > docs/evidence/mcp-curl-$(git rev-parse --short HEAD).txt
```

Comparing with the curl output [mcp-curl-03dc233.txt](mcp-curl-03dc233.txt):

| Step | Expected | What I got |
| --- | --- | --- |
| Protected-resource metadata | 200, `authorization_servers` = your tenant |HTTP/1.1 200 OK authorization_servers":["https://login.microsoftonline.com/1e3a78c9-1d2e-4f9d-bfa2-516560e44854/v2.0"] |
| tools/list, no token | 401, `WWW-Authenticate` with `resource_metadata=` | HTTP/1.1 401 Unauthorizedresource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/mcp"|
| Garbage token | 401 `invalid_token` | HTTP/1.1 401 Unauthorized X-Request-Id: 7ba88ff1-fe06-4b93-91ee-77dcf43f3a8f WWW-Authenticate: Bearer error="invalid_token", error_description="The access token is invalid or expired", resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/mcp" Content-Type: application/json; charset=utf-8 |
| Foreign `Host` header | 403 |HTTP/1.1 403 Forbidden |
| tools/list as Test Reader | 200, six tools |HTTP/1.1 200 OK data: {"result":{"tools":[{"name":"search_releases","title":"Search book releases","description":"... |
| add_to_watchlist without confirmation | `confirmation_required`, nothing written | HTTP/1.1 200 OK data: {"result":{"content":[{"type":"text","text":"Add “Evidence Author MCP” to your Bibliophile watchlist? Nothing has been changed yet. If the user confirms, call add_to_watchlist again with authorName \"Evidence Author MCP\" and confirmationToken \"tlhGlsNKJN4foWCn7fdlzcljvcqDrirm5cIUTCNOXtg\" (valid until 2026-11-18T05:14:34.612Z)."}]|
| Made-up confirmation token | `isError`, nothing written |HTTP/1.1 200 OK data: {"result":{"content":[{"type":"text","text":"That confirmation token isn't valid (expired, already used, or for a different author or user). Start again without a token."}],"isError":true},"jsonrpc":"2.0","id":1} |

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
              at               |            actor_subject             | actor_role |    action     |    entity_id     |        outcome        | reason |                       arguments                                 |              request_id              
-------------------------------+--------------------------------------+------------+---------------+------------------+-----------------------+--------+--------------------------------------------------------------------------+--------------------------------------
 2026-11-18 05:09:34.649917+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | mcp.tool_call | add_to_watchlist | error                 |        | {"author:...skipping...
              at               |            actor_subject             | actor_role |    action     |    entity_id     |        outcome        | reason |                       arguments                                 |              request_id              
-------------------------------+--------------------------------------+------------+---------------+------------------+-----------------------+--------+--------------------------------------------------------------------------+--------------------------------------
 2026-11-18 05:09:34.649917+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | mcp.tool_call | add_to_watchlist | error                 |        | {"authorName": "Evidence Author MCP", "confirmationToken": "[redacted]"} | c728e4c7-3569-4b70-9700-54f23d5f4848
 2026-11-18 05:09:34.615091+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | mcp.tool_call | add_to_watchlist | confirmation_required |        | {"author:...skipping...
              at               |            actor_subject             | actor_role |    action     |    entity_id     |        outcome        | reason |                       arguments                                 |              request_id              
-------------------------------+--------------------------------------+------------+---------------+------------------+-----------------------+--------+--------------------------------------------------------------------------+--------------------------------------
 2026-11-18 05:09:34.649917+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | mcp.tool_call | add_to_watchlist | error                 |        | {"authorName": "Evidence Author MCP", "confirmationToken": "[redacted]"} | c728e4c7-3569-4b70-9700-54f23d5f4848
 2026-11-18 05:09:34.615091+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | mcp.tool_call | add_to_watchlist | confirmation_required |        | {"authorName": "Evidence Author MCP"}                                    | 0895ba17-6ff3-4b6d-9bd5-7a1f0569ba07
 2026-11-18 05:09:34.577199+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | mcp.tool_call | search_releases  | ok                    |        | {"limit": 3, "includePast": false}                                       | bef53fa6-bf84-425f-9343-331f915806e7
 2026-11-18 05:08:56.920583+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | mcp.tool_call | add_to_watchlist | error                 |        | {"author:...skipping...
              at               |            actor_subject             | actor_role |    action     |    entity_id     |        outcome        | reason |                       arguments                                 |              request_id              
-------------------------------+--------------------------------------+------------+---------------+------------------+-----------------------+--------+--------------------------------------------------------------------------+--------------------------------------
 2026-11-18 05:09:34.649917+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | mcp.tool_call | add_to_watchlist | error                 |        | {"authorName": "Evidence Author MCP", "confirmationToken": "[redacted]"} | c728e4c7-3569-4b70-9700-54f23d5f4848
 2026-11-18 05:09:34.615091+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | mcp.tool_call | add_to_watchlist | confirmation_required |        | {"authorName": "Evidence Author MCP"}                                    | 0895ba17-6ff3-4b6d-9bd5-7a1f0569ba07
 2026-11-18 05:09:34.577199+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | mcp.tool_call | search_releases  | ok                    |        | {"limit": 3, "includePast": false}                                       | bef53fa6-bf84-425f-9343-331f915806e7
 2026-11-18 05:08:56.920583+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | mcp.tool_call | add_to_watchlist | error                 |        | {"authorName": "Evidence Author MCP", "confirmationToken": "[redacted]"} | 62551fda-5e87-4fc3-80a0-3197b08423e5
 2026-11-18 05:08:56.853409+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | mcp.tool_call | add_to_watchlist | confirmation_required |        | {"authorName": "Evidence Author MCP"}                                    | af4a1eb9-a68b-4e91-b679-cdcd091fe982
 2026-11-18 05:08:56.775553+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | mcp.tool_call | search_releases  | ok                    |        | {"limit": 3, "includePast": false}                                       | c99f363c-f08b-423d-a042-58da9fbd0efd
 2026-11-17 05:00:57.527423+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | watchlist.add | 7                |                       |        |                                                                 | d5a104ba-2023-438a-bc62-a5f3f7639155
 2026-11-17 04:01:47.484385+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | watchlist.add | 5                |                       |        |                                                                 | 8d0f0e90-85d2-4d5c-81ea-1b95d4860ce5
 2026-11-14 00:41:23.607943+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | watchlist.add | 3                |                       |        |                                                                 | e0fc8164-5503-42d0-b5e9-6aa301f0df00
 2026-11-14 00:10:00.812785+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | watchlist.add | 1                |                       |        |                                                                 | 4e9b645f-676f-460b-a845-64de2b4f885b
(10 rows)

~
(END)...skipping...
```

What to look for: one `mcp.tool_call` row per call; for the follow, the
`confirmation_required` row, then a `watchlist.add` row and an `added` row
with the same user; `[redacted]` instead of the confirmation token; and (if
you did 8a) `mcp.tool_refused` rows with reason `insufficient_scope`.

## 5. Interpretation
The 403 error proves that a read-only token alone can't reach the write tool because the server recognizes the token's limited scope and denies access to any write operations.
The first add_to_watchlist call can't change anything because it lacks the required confirmation token, which the server demands to prevent unauthorized modifications. Only when the user provides the correct confirmation token can the server proceed with updating the watchlist. The audit rows tie each call to a user by recording the user identity alongside the tool call, ensuring accountability and traceability. The app needs no authorization of its own because all actions are mediated through the user's token and the server enforces the necessary access controls based on that token.