# Secrets inventory

This file lists every secret the project uses **by name only**. Values never
appear in this repo, in images, logs, screenshots or the browser bundle
(hard gate 1). Every variable, secret or not, is in [`.env.example`](../.env.example).

Fill in the "Stored in" column as each environment is set up (build step 8).

| Name | What it's for | Environments | Stored in | How to rotate |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` (contains DB password) | API connection to Postgres | staging, production (separate DBs and passwords) | _host secret store — fill in_ | Change the DB user's password in the provider, update the secret, redeploy |
| `GOOGLE_BOOKS_API_KEY` | Server-side calls to Google Books (F10) | staging, production (separate keys) | _host secret store — fill in_ | Google Cloud console → Credentials → create new key, update secret, redeploy, delete old key |
| _CI deploy token_ | CI/CD deploying to the host (D4) | CI only | _CI secrets — fill in_ | Revoke in the host dashboard, create new, update CI secret |

## Not secrets (safe in config and in the browser)

- `ENTRA_TENANT_ID`, `ENTRA_API_CLIENT_ID`, `VITE_ENTRA_*`: Entra IDs are
  public identifiers that appear in every login URL.
- There is **no Entra client secret**. The web app is a public client using
  PKCE, and the API only validates tokens using Microsoft's published keys.
- `PUBLIC_BASE_URL`, `MCP_APP_HTML`: the API's public address and the path of
  the built MCP App.
- MCP has **no secret of its own**: `/mcp` validates the same Entra access
  tokens as the REST API. MCP confirmation tokens are random, single-use,
  expire after 5 minutes, and are redacted in the audit log. The MCP dev host
  keeps a pasted access token in page memory only.
- A client secret for a future MCP host registration (only if that host is a
  confidential client, step 8) would go into the host's own connector
  settings, and into the table above.
- The local Docker database password (`app`), which only exists on your laptop.

## Rules

- `.env` files are git-ignored. Before every commit: `git status` must not
  list any `.env`.
- Vite puts every `VITE_*` variable into the public JavaScript bundle, so a
  secret must never have a `VITE_` prefix.
- The app never logs a secret. Config errors print the variable *name* only
  (`api/src/config.ts`).
- The Google Books key is restricted to the Books API (and to the server's IP
  if the host allows it), so a leaked key can't be used for anything else.

## Hand-off to the instructor (end of project)

1. Prefer giving **staging** credentials, not production.
2. Send them as a separate file through a private channel (the course
   submission system or a password-protected file). Never inside the project
   zip, a repo or a screenshot.
3. After grading, rotate everything in the table above.

Hand-off date: ________  Rotated on: ________
