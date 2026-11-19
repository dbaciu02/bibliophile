# Secrets inventory

This file lists every secret the project uses **by name only**. Values never
appear in this repo, in images, logs, screenshots or the browser bundle
(hard gate 1). Every variable, secret or not, is in [`.env.example`](../.env.example).

Where each one lives after the deployment ([deployment.md](deployment.md)).
For grading, the values go to the instructor in a separate file through a
private channel, and every one is rotated afterwards.

| Name | What it's for | Environments | Stored in | How to rotate |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` (contains the DB login's password) | API connection to Postgres | staging (`bibliophile_staging`), production (`bibliophile_prod`): separate logins and passwords | Render → each service → Environment | Re-run `scripts/deploy/create-databases.sh` (new passwords for both), paste the new internal URLs, redeploy |
| Render admin DB URL | One-time database setup only | — | Not stored: pasted into the terminal for `create-databases.sh`, then `unset` | Render → database → rotate the default user's password |
| `GOOGLE_BOOKS_API_KEY` | Server-side calls to Google Books (F10) | staging, production (separate keys, restricted to the Books API) | Render → each service → Environment | Google Cloud console → Credentials → create a new key, update Render, redeploy, delete the old key |
| `RENDER_DEPLOY_HOOK` | CI triggering a deploy of one image (D4) | staging, production (one per service) | GitHub → Environments → staging / production → Secrets | Render → service → Settings → Deploy Hook → Regenerate, update the GitHub secret |
| `NETLIFY_AUTH_TOKEN` | CI uploading the website (D4) | CI only | GitHub → repository Secrets | Netlify → User settings → Applications → revoke, create new, update secret |
| GHCR pull token (classic PAT, `read:packages` only) | Render pulling the private API image | both services | Render → Registry Credentials | GitHub → Developer settings → revoke, create new, update Render |
| `GITHUB_TOKEN` | CI pushing/reading the image in GHCR | CI only | Created by GitHub for each run; expires with the run | Nothing to rotate |

`NETLIFY_SITE_ID` is stored as a GitHub secret only to keep it out of logs;
it is an identifier, not a credential.

## Not secrets (safe in config and in the browser)

- `ENTRA_TENANT_ID`, `ENTRA_API_CLIENT_ID`, `VITE_ENTRA_*`: Entra IDs are
  public identifiers that appear in every login URL.
- There is **no Entra client secret**. The web app is a public client using
  PKCE, and the API only validates tokens using Microsoft's published keys.
- `PUBLIC_BASE_URL`, `MCP_APP_HTML`, `CORS_ORIGINS`, `VITE_API_BASE_URL`,
  `CERT_HOSTS`, `API_URL`, `WEB_URL`, `STAGING_API_URL`: public addresses.
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
