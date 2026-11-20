# Deployment (build step 8: D1–D7, S1)

Two environments, each with its own website, API, database, Entra
registrations and secrets. Everything below is clicks in web dashboards
plus two scripts; nothing secret goes into the repository.

```
                  ┌──────────── Porkbun DNS (your domain) ────────────┐
 browser ──HTTPS──▶ bibliophile.<domain>            CNAME → Netlify (prod site, CDN)
                  │ staging.bibliophile.<domain>    CNAME → Netlify (staging site, CDN)
 browser ──HTTPS──▶ api.bibliophile.<domain>        CNAME → Render (prod API)
                  │ api.staging.bibliophile.<domain> CNAME → Render (staging API)
                  └────────────────────────────────────────────────────┘
 Render API ──▶ Render Postgres (one free instance: databases bibliophile_prod / bibliophile_staging,
                                  each with its own login)
 Render API ──▶ Google Books · Entra ID (token signing keys)
 GitHub Actions: test → image (GHCR) → staging → gate → [manual promote] → production → gate/rollback
```

Replace `<domain>` with your domain (e.g. `example.com`) and `<you>` with your
GitHub username **in lowercase** everywhere below.

| | Production | Staging |
| --- | --- | --- |
| Website | `https://bibliophile.<domain>` | `https://staging.bibliophile.<domain>` |
| API | `https://api.bibliophile.<domain>` | `https://api.staging.bibliophile.<domain>` |
| Render service | `bibliophile-api` | `bibliophile-api-staging` |
| Database / login | `bibliophile_prod` | `bibliophile_staging` |
| Netlify site | `bibliophile-<you>` | `bibliophile-staging-<you>` |
| Entra registrations | `booktracker-api`, `booktracker-web` (existing) | `booktracker-api-staging`, `booktracker-web-staging` (new) |

Order matters (each step needs something from the one before). Budget about
two hours, most of it waiting for DNS and certificates.

---

## 1. Push the code, so the first image exists

Commit everything and push to `main`. In GitHub → **Actions**, the `deploy`
workflow runs: `test` and `image` should go green; `staging` fails with
"Not set for the staging environment: …". That's expected until section 8.

The image is now at `ghcr.io/<you>/bibliophile-api:sha-<commit>` (GitHub →
your profile → **Packages**). Note the full commit SHA from the run's
summary; you need it in 4c.

## 2. Render: the database

1. Render dashboard → **New → Postgres**. Name `bibliophile-db`, region
   e.g. **Ohio**, PostgreSQL 16 or newer, instance type **Free** → Create.
   (Free databases expire 30 days after creation; see "Honest limits".)
2. When it's *Available*, open it → **Connect → External** → copy the
   **External Database URL**.
3. On your Mac, from the project root:

   ```bash
   export ADMIN_URL='<paste the External Database URL>'
   scripts/deploy/create-databases.sh
   unset ADMIN_URL
   ```

   It creates `bibliophile_staging` and `bibliophile_prod`, each owned by its
   own login, and checks that the staging login is **refused** on the
   production database. It prints two URLs per environment. Keep the terminal
   open; you paste the *internal* ones into Render in section 4 and use the
   *external* ones for seeding in section 9. Don't save them in a file or send
   them to anyone (they contain passwords).

## 3. Entra: staging registrations and the new redirect URIs

**3a. Staging registrations.** Repeat sections 2–4 of
[entra-id-setup.md](entra-id-setup.md) with the names
`booktracker-api-staging` and `booktracker-web-staging` (same scopes, roles,
`accessTokenAcceptedVersion: 2`, assign Test Reader → Reader and Test
Curator → Curator on the *staging* API's enterprise app). On
`booktracker-web-staging` → Authentication → SPA redirect URI
`https://staging.bibliophile.<domain>/auth/callback`. A staging token then
has a different audience, so production refuses it.

**3b. Production redirect.** On the existing `booktracker-web` →
Authentication → add SPA redirect URI
`https://bibliophile.<domain>/auth/callback` (keep the localhost one for
development).

## 4. Render: the two API services

**4a. Let Render pull your private image.** GitHub → Settings → Developer
settings → **Personal access tokens → Tokens (classic)** → Generate new
token (classic): note `render-ghcr-pull`, expiry 30 days, scope **only
`read:packages`**. Copy it. Render → **Workspace Settings → Container
Registry Credentials (or Registry Credentials) → Add**: registry *GitHub*,
username `<you>`, the token. (This token can only read your packages.)

**4b. Google Books key for staging.** Google Cloud Console → APIs & Services
→ Credentials → **Create credentials → API key**, restrict it to the *Books
API*. Production keeps your existing key. (Separate keys = a leak in one
environment doesn't touch the other.)

**4c. Create the services.** Render → **New → Web Service → Existing
Image** → `ghcr.io/<you>/bibliophile-api:sha-<commit from section 1>`, pick the
credential from 4a. Do it twice:

| Setting | `bibliophile-api-staging` | `bibliophile-api` |
| --- | --- | --- |
| Region | same as the database | same as the database |
| Instance type | Free | Free |
| Health Check Path (Advanced) | `/healthz` | `/healthz` |
| `NODE_ENV` | `production` | `production` |
| `DATABASE_URL` | staging **internal** URL from section 2 | prod **internal** URL from section 2 |
| `ENTRA_TENANT_ID` | your tenant id | your tenant id |
| `ENTRA_API_CLIENT_ID` | `booktracker-api-staging` client id (section 3) | `booktracker-api` client id |
| `GOOGLE_BOOKS_API_KEY` | the new staging key (4b) | your existing key |
| `PUBLIC_BASE_URL` | `https://api.staging.bibliophile.<domain>` | `https://api.bibliophile.<domain>` |
| `CORS_ORIGINS` | `https://staging.bibliophile.<domain>` | `https://bibliophile.<domain>` |

Mark `DATABASE_URL` and `GOOGLE_BOOKS_API_KEY` as secret if Render offers it.
Telemetry variables (`OTEL_*`, `DEPLOY_ENV`) come later, from
[observability.md](observability.md); the API runs fine without them.
The Health Check Path matters: Render only switches traffic to a new deploy
once `/healthz` answers 200, so a broken build keeps the old one serving.

**4d. Deploy hooks.** Each service → **Settings → Deploy Hook** → copy the
URL. It's a secret (anyone holding it can deploy), so it goes only into
GitHub (section 8).

## 5. Netlify: the two website projects

**5a. Projects.** Netlify → **Add new project → Deploy manually** →
drag any folder with an `index.html` (a placeholder; CI replaces it). Twice.
Rename them (Project configuration → Change project name) to
`bibliophile-<you>` and `bibliophile-staging-<you>`. For each, note the
**Project ID** (Project configuration → General). That's `NETLIFY_SITE_ID`.

**5b. Token.** User settings → **Applications → Personal access
tokens → New access token** (expiry 30 days). Copy it for section 8.

## 6. Porkbun: DNS records

### 6a. Check what CAs your domain already uses (before adding CAA)

A CAA record lists which certificate authorities may issue certificates for
the domain **and all its subdomains**, so it must also allow whatever your
existing site uses, or that site's next renewal fails.

```bash
dig +short CAA <domain>                       # existing CAA records, if any
echo | openssl s_client -connect <domain>:443 -servername <domain> 2>/dev/null | openssl x509 -noout -issuer
echo | openssl s_client -connect www.<domain>:443 -servername www.<domain> 2>/dev/null | openssl x509 -noout -issuer
```

Map the issuer's organisation to its CAA name: Let's Encrypt →
`letsencrypt.org`, Google Trust Services → `pki.goog`, Sectigo or ZeroSSL →
`sectigo.com`, DigiCert → `digicert.com`, Amazon → `amazon.com`. If `dig`
already printed CAA records, keep them all and only add what's missing. Email
hosted at Porkbun or elsewhere normally uses the provider's own certificates
and isn't affected.

### 6b. Add the records

Porkbun → **Domain Management** → your domain → **DNS** → add:

| Type | Host | Answer | TTL |
| --- | --- | --- | --- |
| CNAME | `bibliophile` | `bibliophile-<you>.netlify.app` | 600 |
| CNAME | `staging.bibliophile` | `bibliophile-staging-<you>.netlify.app` | 600 |
| CNAME | `api.bibliophile` | `bibliophile-api.onrender.com` | 600 |
| CNAME | `api.staging.bibliophile` | `bibliophile-api-staging.onrender.com` | 600 |
| CAA | *(blank = the domain itself)* | `0 issue "letsencrypt.org"` | 3600 |
| CAA | *(blank)* | `0 issue "pki.goog"` | 3600 |
| CAA | *(blank)* | `0 issue "<your existing CA from 6a>"` (one per CA, if not already covered) | 3600 |
| CAA | *(blank)* | `0 iodef "mailto:<your email>"` | 3600 |

Use the exact `.netlify.app` names from 5a and the `.onrender.com` names
from each Render service's page.

**TTL rationale (D1).** CNAMEs: 600 s, Porkbun's minimum. These records may
still change during the course (a host move, a rollback to another
service), and a short TTL means a change reaches everyone within 10 minutes.
The cost is more lookups, which is irrelevant at this traffic. CAA: 3600 s.
It changes rarely, and CAs re-check it at every issuance. An hour is short
enough to fix a mistake the same day.

**Why CAA is on the main domain:** a name with a CNAME can't have other
records, so the CAA lookup for `api.bibliophile.<domain>` follows the CNAME
and then climbs to `<domain>`.

## 7. Custom domains and HTTPS

Do this once the CNAMEs from section 6 exist (check with
`dig +short CNAME api.bibliophile.<domain>`).

**7a. Render.** Each service → **Settings → Custom Domains → Add**:
`api.staging.bibliophile.<domain>` and `api.bibliophile.<domain>`. Render
checks the CNAME and issues the certificate (a few minutes). Render redirects
HTTP to HTTPS by itself.

**7b. Netlify.** Each project → **Domain management → Add a domain**
→ `bibliophile.<domain>` / `staging.bibliophile.<domain>` → choose
**external DNS**. Then **HTTPS →
Verify DNS configuration → Provision certificate**. Netlify redirects HTTP to
HTTPS by itself once the certificate exists.

## 8. GitHub: environments, secrets and variables

Repository → **Settings → Environments → New environment**: `staging`, then
`production`. In each, add:

| Kind | Name | staging | production |
| --- | --- | --- | --- |
| Secret | `RENDER_DEPLOY_HOOK` | staging service's hook (4d) | prod service's hook (4d) |
| Secret | `NETLIFY_SITE_ID` | staging project ID (5a) | prod project ID (5a) |
| Variable | `API_URL` | `https://api.staging.bibliophile.<domain>` | `https://api.bibliophile.<domain>` |
| Variable | `WEB_URL` | `https://staging.bibliophile.<domain>` | `https://bibliophile.<domain>` |
| Variable | `VITE_ENTRA_TENANT_ID` | tenant id | tenant id |
| Variable | `VITE_ENTRA_CLIENT_ID` | `booktracker-web-staging` client id | `booktracker-web` client id |
| Variable | `VITE_ENTRA_API_CLIENT_ID` | `booktracker-api-staging` client id | `booktracker-api` client id |
| Variable | `STAGING_API_URL` | — | `https://api.staging.bibliophile.<domain>` |

Repository-level (**Settings → Secrets and variables → Actions**):

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `NETLIFY_AUTH_TOKEN` | the token from 5b |
| Variable | `CERT_HOSTS` | `bibliophile.<domain> staging.bibliophile.<domain> api.bibliophile.<domain> api.staging.bibliophile.<domain>` |

If your plan offers it, add yourself as a **Required reviewer** on the
`production` environment too. `promote` already refuses anything that isn't
healthy on staging, so this is an extra gate.

## 9. First deploy, then seed

1. GitHub → Actions → the failed `deploy` run → **Re-run failed jobs**. The
   `staging` job deploys the image to Render, waits for
   `https://api.staging…/healthz` to report this commit, deploys the website
   and runs the smoke checks. The first run may wait a minute or two while
   the free service wakes and runs the migrations.
2. Seed the synthetic books (from your Mac, with the *external* URLs from
   section 2):

   ```bash
   DATABASE_URL='<staging external url>' NODE_ENV=production ALLOW_SEED=1 npm run seed --workspace api
   DATABASE_URL='<prod external url>'    NODE_ENV=production ALLOW_SEED=1 npm run seed --workspace api
   ```

3. Open `https://staging.bibliophile.<domain>`, sign in as Test Reader, and
   check that the releases list, the watchlist and the Live pill work.
4. **Release to production:** Actions → **promote** → Run workflow → paste
   the full commit SHA (it's in the staging run's summary). It checks staging
   runs that commit, deploys the same image digest to production, waits for
   production `/healthz`, then deploys the production website.

From now on: push to `main` → staging updates by itself → when happy, run
`promote` with that commit.

## Rollback

- **Automatic:** if production `/healthz` doesn't report the new commit
  within 15 minutes, `promote` redeploys the image production was running
  before, and the run is marked failed.
- **By hand (API):** Actions → **rollback** → environment + the commit to go
  back to. Every build stays in GHCR as `:sha-<commit>`.
- **By hand (website):** Netlify → the project → **Deploys** → the earlier
  deploy (its message is its commit) → **Publish deploy**.

## Honest limits

- **The free database expires 30 days after creation** (Render deletes it 14
  days later unless upgraded, about $6/month). That's enough for grading;
  after that, upgrade or export it (`pg_dump`).
- **One Postgres instance for both environments.** The data and logins are
  separate (staging's login is refused on the production database, as
  checked by the setup script), but load or an outage on the instance hits
  both. Separate instances need a paid plan.
- **Free API services sleep after 15 minutes idle** and take about a minute to
  wake. The first request after a quiet spell is slow, which shows up in
  latency measurements (step 9).
- **Rate limits are per instance, in memory.** Fine with one instance per
  environment; more instances would need a shared store.
- **Both environments share one Postgres server**, so the cluster-wide
  advisory lock used to order live-update events is shared too. Writes in
  staging and production can wait on each other for a moment. That's harmless
  at this scale.
