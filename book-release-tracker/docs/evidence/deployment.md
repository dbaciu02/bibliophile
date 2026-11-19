# D1–D7, S1 — Deployment evidence

Setup: [docs/deployment.md](../deployment.md). Replace `<domain>` with your
domain. Paste raw output where it says *(paste)*; take screenshots where it
says *(screenshot)*. Commit `_______`, date `11-18-2026`.

Put these in one terminal first:

```bash
D=<domain>
WEB=https://bibliophile.$D;          API=https://api.bibliophile.$D
SWEB=https://staging.bibliophile.$D; SAPI=https://api.staging.bibliophile.$D
```

## D1 — Own domain, DNS records, TTL rationale

```bash
dig +trace bibliophile.$D | tail -20     # the delegation chain down to Porkbun's servers
for h in bibliophile staging.bibliophile api.bibliophile api.staging.bibliophile; do dig +noall +answer $h.$D; done
dig +noall +answer CAA $D
```

*(paste)*. A screenshot of the Porkbun DNS page serves as the zone export.
TTL rationale: [deployment.md, section 6b](../deployment.md). Restate it in
your own words in the interpretation below.

## D2 — HTTPS only, renewal, CAA, redirect, expiry alert that fired

```bash
curl -sI http://bibliophile.$D | head -3          # expect 301 to https://
curl -sI http://api.bibliophile.$D | head -3      # expect a redirect to https://
echo | openssl s_client -connect bibliophile.$D:443 -servername bibliophile.$D -showcerts 2>/dev/null | grep -E "^ *[0-9] s:|^ *i:"
echo | openssl s_client -connect api.bibliophile.$D:443 -servername api.bibliophile.$D 2>/dev/null | openssl x509 -noout -issuer -dates
curl -sI $WEB | grep -i strict-transport
```

*(paste)*

- Auto-renewal: Netlify → Domain management → HTTPS shows the certificate and
  that it renews automatically; the same for Render → Custom Domains.
  *(screenshots)*
- **The alert firing:** Actions → **cert-check** → Run workflow with
  `min_days` = **120**. Let's Encrypt certificates live 90 days, so every host
  is under the threshold and the run **fails**. GitHub then emails you about
  the failed run. *(screenshot of the failed run's summary table + the
  email)*. Then run it again with the default 21: green. *(screenshot)*

## D3 — Separate staging and production; a change stopped at staging

```bash
curl -s $SAPI/healthz; echo; curl -s $API/healthz; echo
```

*(paste)*. Two URLs, each reporting its own commit.

Separation (from section 2 of the setup): the output of
`create-databases.sh` ending in `ok, refused: permission denied for database
"bibliophile_prod"`. Paste that line only, not the URLs above it.

**A change stopped at staging** (the deliberate failure):

1. Make a commit that breaks startup. In `api/src/server.ts`, add as the
   first line after the imports:
   `if (process.env.NODE_ENV === "production") throw new Error("deliberate failure: D3 evidence");`
   The tests still pass (they don't start `server.ts`), so it gets as far as
   staging.
2. Push. In the `deploy` run: `test` ✅, `image` ✅, `staging` ❌ at "Gate:
   staging /healthz reports this commit" (it waits up to 15 minutes, then
   fails). Meanwhile check `curl $SAPI/healthz`. Render keeps the old version
   serving when a new deploy fails its health check, so it should still
   answer with the **old** commit. Record what you actually see.
   *(screenshot of the run + the curl)*
3. Try to release it anyway: Actions → **promote** → that commit's SHA. It
   fails at "Gate: this commit is healthy on staging" ("is not what staging
   is running"). Production never changed: `curl $API/healthz`.
   *(screenshot + curl)*
4. `git revert HEAD && git push`. Staging goes green again.

## D4 — CI/CD with SHA + digest, health gate, rollback

- A green `deploy` run and a green `promote` run. Each run's **Summary**
  shows the commit and the image digest. *(screenshots)*
- The gate log lines (`... -> HTTP 200 commit=<sha>` / `Healthy on <sha>`).
  *(paste from the job log)*
- **Rollback:** Actions → **rollback** → `production` → the *previous* commit
  (from the last promote summary, "previous commit"). Afterwards
  `curl $API/healthz` shows that older commit. Then **promote** the current
  commit again. *(screenshots + both curls)*

## D5 — Reproducible: config in the repo, clean machine

- The deployment is described by files in the repo: `Dockerfile`,
  `.github/workflows/*.yml`, `scripts/deploy/*`, `web/scripts/write-netlify-files.mjs`,
  and the dashboard settings tables in `docs/deployment.md`.
- Clean clone: `git clone <repo> /tmp/clean && cd /tmp/clean`, then follow the
  README "Run it on a clean machine" section. *(paste the last lines of
  `npm test`)*

## D6 — CDN cache policy per content class

```bash
ASSET=$(curl -s $WEB/ | grep -o '/assets/[^"]*\.js' | head -1); echo $ASSET
for i in 1 2; do curl -sI "$WEB$ASSET" | grep -iE "^(cache-control|cache-status|age):"; echo; done
for i in 1 2; do curl -sI "$WEB/" | grep -iE "^(cache-control|cache-status|etag):"; echo; done
ETAG=$(curl -sI "$WEB/" | tr -d '\r' | grep -i '^etag:' | cut -d' ' -f2-)
curl -s -o /dev/null -w "revalidate with ETag -> %{http_code}\n" -H "If-None-Match: $ETAG" "$WEB/"
curl -sI "$API/api/me/watchlist" -H "Authorization: Bearer $READER_TOKEN" | grep -i cache-control
```

*(paste)*. What to look for: the asset says `immutable` and its second
request is a **hit**; the HTML says `max-age=0, must-revalidate`; the ETag
request gets **304**; the personal watchlist says `private, no-store`.

**Invalidation:** promote a new commit, then repeat the HTML request. It's a
**miss** with a new ETag (Netlify invalidates on every deploy), then a hit
again. *(paste)*

## D7 — CORS allowlist; security headers

```bash
curl -si -X OPTIONS -H "Origin: $WEB" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: authorization,content-type" "$API/api/me/watchlist" | head -12
curl -si -X OPTIONS -H "Origin: https://evil.example" -H "Access-Control-Request-Method: POST" "$API/api/me/watchlist" | head -12
curl -si -X OPTIONS -H "Origin: $SWEB" -H "Access-Control-Request-Method: POST" "$API/api/me/watchlist" | head -3   # staging site -> prod API: refused too
curl -sI $WEB | grep -iE "content-security|strict-transport|x-content-type|referrer-policy|x-frame"
curl -sI $API/healthz | grep -iE "content-security|strict-transport|x-content-type|referrer-policy|x-frame"
```

*(paste)*. Allowed preflight → **204** naming your site; others → **403**
with no `Access-Control-Allow-Origin`. The staging site is refused by the
production API: the allowlist is exact per environment.

## S1 — Rate limits, live

On **staging** (it costs Google quota, and you don't want test data in
production), with a Test Curator token from the staging site:

```bash
for i in $(seq 1 31); do curl -s -o /dev/null -w "%{http_code} " -H "Authorization: Bearer $CURATOR_TOKEN" "$SAPI/api/books/search?q=dune"; done; echo
curl -si -H "Authorization: Bearer $CURATOR_TOKEN" "$SAPI/api/books/search?q=dune" | grep -iE "^HTTP|retry-after|ratelimit"
```

*(paste)*. Thirty 200s, then 429 with `Retry-After`. Login is rate-limited by
Entra ID itself (Microsoft's sign-in throttling and lockout). Write routes are
limited per user (watchlist 30/min, curator writes 120/min, MCP 120/min);
`api/test/security.test.ts` shows the 31st watchlist write getting 429.

## Interpretation

_(In your own words: what each piece of output proves. Include the TTL choice,
why a CNAME'd name inherits the main domain's CAA, how the gate stopped the
broken commit at staging, what the rollback changed, why the personal
response isn't cached, and why the staging site is refused by the production
API.)_
