# Entra ID setup (requirements F7, F8, F9, F12)

This is the one part of the project done by clicking in the Microsoft Entra
admin center (https://entra.microsoft.com) instead of in code. Do it once for
local development; staging and production each get their own redirect URIs
(and ideally their own app registrations — see step 7).

Write down every ID you collect in a private note. **Tenant and client IDs are
not secrets** (they appear in the browser anyway). This setup creates **no
client secret** at all: the SPA is a public client using PKCE, and the API only
*validates* tokens, which needs Microsoft's public keys, not a secret.

---

## 0. Get a tenant where you are the admin

Don't use DePaul's tenant — you won't be allowed to register apps or assign
roles there, and it holds real institutional accounts (hard gate: synthetic
data only).

1. Create a free Azure account if you don't have one (Azure for Students works).
2. In the Entra admin center, check the top-right corner under your name. If
   there's a directory name, you have a tenant. If you see only a GUID, create
   one by following Microsoft's quickstart
   (https://learn.microsoft.com/entra/fundamentals/create-new-tenant —
   usually **Manage tenants → Create → Microsoft Entra ID**). Choose a
   workforce "Microsoft Entra ID" tenant, not B2C or External ID. Name it
   something like `booktrackerdev` (letters and digits only).
3. Copy the **Tenant ID** from **Entra ID → Overview → Properties**.
   → `ENTRA_TENANT_ID`

## 1. Create two synthetic test users

**Entra ID → Users → New user → Create new user**, twice:

| Display name | User principal name | Will get role |
| --- | --- | --- |
| Test Reader | `reader@<tenant>.onmicrosoft.com` | Reader |
| Test Curator | `curator@<tenant>.onmicrosoft.com` | Curator |

These made-up accounts are what you demo and test with. Never put a real
person's account in the app's data.

## 2. Register the API (the "resource")

**Entra ID → App registrations → New registration**

- Name: `booktracker-api`
- Supported account types: **Accounts in this organizational directory only**
- Redirect URI: leave empty
- Copy the **Application (client) ID** → `ENTRA_API_CLIENT_ID`

### 2a. Ask for v2 access tokens  ⚠️ easy to miss

**Manifest** → set the access token version to `2`
(`"requestedAccessTokenVersion": 2` inside the `api` section; older manifest
editors call it `accessTokenAcceptedVersion`). Save.

Why: without this you get v1 tokens with a different issuer
(`https://sts.windows.net/<tenant>/`) and audience format, and the issuer check
in step 3 of the build will reject every token.

### 2b. Expose the scopes (per-tool / per-route permissions)

**Expose an API → Application ID URI → Add** → accept `api://<api-client-id>`.

Then **Add a scope** for each row (who can consent: *Admins and users*):

| Scope name | Used for |
| --- | --- |
| `Releases.Read` | MCP read tools |
| `Watchlist.ReadWrite` | Reader's watchlist routes and the MCP write tool |
| `Releases.Write` | Curator catalog routes |

Scopes say *what the app may do on the user's behalf*; roles (next) say *what
the user is allowed to do*. The API checks both.

### 2c. Define the app roles

**App roles → Create app role**, twice. Allowed member types: **Users/Groups**.

| Display name | Value | Description |
| --- | --- | --- |
| Reader | `Reader` | Browse releases and manage own watchlist |
| Curator | `Curator` | Add, edit and hide catalog releases |

## 3. Register the frontend (the SPA)

**App registrations → New registration**

- Name: `booktracker-web`
- Supported account types: **this organizational directory only**
- Redirect URI: platform **Single-page application (SPA)**,
  `http://localhost:5173/auth/callback`
- Copy its **Application (client) ID** → `VITE_ENTRA_CLIENT_ID` (used in step 3 of the build)

Choosing the **SPA** platform matters: it turns on Authorization Code + PKCE
and CORS on the token endpoint. Don't enable "Access tokens" or "ID tokens"
under *Implicit grant* — that's the old flow the spec doesn't allow.

### 3a. Let the SPA request the API's scopes

**API permissions → Add a permission → APIs my organization uses →
booktracker-api → Delegated** → tick all three scopes → **Add**.
Then **Grant admin consent for <tenant>**.

## 4. Assign roles to the test users

**Entra ID → Enterprise applications → booktracker-api → Users and groups →
Add user/group**:

- Test Reader → **Reader**
- Test Curator → **Curator**

(Assign users individually — assigning *groups* needs a paid Entra tier.)

Optional but recommended: **Enterprise applications → booktracker-api →
Properties → Assignment required? = Yes**, so a tenant user with no role can't
get a token for the API at all.

## 5. Check a token before writing any auth code

Once login exists (build step 3), copy an access token from the browser's
dev tools and decode it locally (e.g. `npx jwt-decode-cli` or a few lines of
Node — avoid pasting tokens into random websites). You should see:

| Claim | Expected |
| --- | --- |
| `ver` | `"2.0"` |
| `iss` | `https://login.microsoftonline.com/<tenant-id>/v2.0` |
| `aud` | `<api-client-id>` |
| `scp` | e.g. `"Releases.Read Watchlist.ReadWrite"` |
| `roles` | `["Reader"]` or `["Curator"]` |
| `oid` | the user's object id → stored as `users.idp_subject` |

The signing keys the API will use are published at
`https://login.microsoftonline.com/<tenant-id>/discovery/v2.0/keys`.

Screenshot this (with the token itself redacted) for the F7/F8 evidence.

## 6. Values the app needs

| Variable | Where | Secret? |
| --- | --- | --- |
| `ENTRA_TENANT_ID` | api + web | No |
| `ENTRA_API_CLIENT_ID` | api (audience check) + web (scope names) | No |
| `VITE_ENTRA_CLIENT_ID` | web | No |

## 7. Staging and production (later, build step 8)

Requirement D3 wants separate secrets and data per environment. The simplest
clean setup is a second pair of registrations (`booktracker-api-staging`,
`booktracker-web-staging`) so a staging token can never be accepted by
production (different `aud`). Add each environment's
`https://<host>/auth/callback` as a SPA redirect URI on its own web
registration.
