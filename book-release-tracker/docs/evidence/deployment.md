# D1–D7, S1 — Deployment evidence

Setup: [docs/deployment.md](../deployment.md). Date `11-20-2026`.

Put these in one terminal first:

```bash
D=dorabaciu.dev
WEB=https://bibliophile.$D;          API=https://api.bibliophile.$D
SWEB=https://staging.bibliophile.$D; SAPI=https://api.staging.bibliophile.$D
```

## D1 — Own domain, DNS records, TTL rationale

```bash
dig +trace bibliophile.$D | tail -20 
for h in bibliophile staging.bibliophile api.bibliophile api.staging.bibliophile; do dig +noall +answer $h.$D; done
dig +noall +answer CAA $D
```
Output:
```

; <<>> DiG 9.10.6 <<>> +trace bibliophile.dorabaciu.dev
;; global options: +cmd
;; Received 28 bytes from 192.168.1.254#53(192.168.1.254) in 2 ms

bibliophile.dorabaciu.dev. 600  IN      CNAME   bibliophile-dbaciu02.netlify.app.
bibliophile-dbaciu02.netlify.app. 120 IN A      98.84.224.111
bibliophile-dbaciu02.netlify.app. 120 IN A      18.208.88.157
staging.bibliophile.dorabaciu.dev. 600 IN CNAME bibliophile-staging-dbaciu02.netlify.app.
bibliophile-staging-dbaciu02.netlify.app. 120 IN A 98.84.224.111
bibliophile-staging-dbaciu02.netlify.app. 120 IN A 18.208.88.157
api.bibliophile.dorabaciu.dev. 600 IN   CNAME   bibliophile-api.onrender.com.
bibliophile-api.onrender.com. 300 IN    CNAME   gcp-us-west1-1.origin.onrender.com.
gcp-us-west1-1.origin.onrender.com. 208 IN CNAME gcp-us-west1-1.origin.onrender.com.cdn.cloudflare.net.
gcp-us-west1-1.origin.onrender.com.cdn.cloudflare.net. 10 IN A 216.24.57.18
gcp-us-west1-1.origin.onrender.com.cdn.cloudflare.net. 10 IN A 216.24.57.16
api.staging.bibliophile.dorabaciu.dev. 600 IN CNAME bibliophile-api-staging.onrender.com.
bibliophile-api-staging.onrender.com. 300 IN CNAME gcp-us-west1-1.origin.onrender.com.
gcp-us-west1-1.origin.onrender.com. 207 IN CNAME gcp-us-west1-1.origin.onrender.com.cdn.cloudflare.net.
gcp-us-west1-1.origin.onrender.com.cdn.cloudflare.net. 9 IN A 216.24.57.18
gcp-us-west1-1.origin.onrender.com.cdn.cloudflare.net. 9 IN A 216.24.57.16
dorabaciu.dev.          3600    IN      CAA     0 issue "pki.goog"
dorabaciu.dev.          3600    IN      CAA     0 issue "letsencrypt.org"
```

A screenshot of the Porkbun DNS page serves as the zone export is in evidence/screenshots.
TTL rationale: [deployment.md, section 6b](../deployment.md). 

## D2 — HTTPS only, renewal, CAA, redirect, expiry alert that fired

```bash
curl -sI http://bibliophile.$D | head -3          
curl -sI http://api.bibliophile.$D | head -3      
echo | openssl s_client -connect bibliophile.$D:443 -servername bibliophile.$D -showcerts 2>/dev/null | grep -E "^ *[0-9] s:|^ *i:"
echo | openssl s_client -connect api.bibliophile.$D:443 -servername api.bibliophile.$D 2>/dev/null | openssl x509 -noout -issuer -dates
curl -sI $WEB | grep -i strict-transport
```

Output:

```
HTTP/1.1 301 Moved Permanently
Content-Type: text/plain; charset=utf-8
Date: Sat, 21 Nov 2026 03:35:46 GMT
HTTP/1.1 301 Moved Permanently
Date: Sat, 21 Nov 2026 03:35:46 GMT
Content-Type: text/html; charset=utf-8
 0 s:CN=bibliophile.dorabaciu.dev
   i:C=US, O=Let's Encrypt, CN=YE2
 1 s:C=US, O=Let's Encrypt, CN=YE2
   i:C=US, O=ISRG, CN=Root YE
 2 s:C=US, O=ISRG, CN=Root YE
   i:C=US, O=Internet Security Research Group, CN=ISRG Root X2
 3 s:C=US, O=Internet Security Research Group, CN=ISRG Root X2
   i:C=US, O=Internet Security Research Group, CN=ISRG Root X1
issuer=C=US, O=Google Trust Services, CN=WE1
notBefore=Nov 20 01:21:32 2026 GMT
notAfter=Feb 18 02:21:30 2027 GMT
strict-transport-security: max-age=31536000; includeSubDomains
```

- Auto-renewal: Netlify → Domain management → HTTPS shows the certificate and
  that it renews automatically; the same for Render → Custom Domains.
  *(screenshots)*
- **The alert firing:** Actions → **cert-check** → Run workflow with
  `min_days` = **120**. Let's Encrypt certificates live 90 days, so every host
  is under the threshold and the run **fails**. GitHub then emails you about
  the failed run. *(screenshot of the failed run's summary table + the
  email)*. Then run it again with the default 21: green. *(screenshot)*

- D2 evidence: can find in `docs/evidence/screenshots` folder!

## D3 — Separate staging and production; a change stopped at staging

```bash
SAPI=https://api.staging.bibliophile.dorabaciu.dev
API=https://api.bibliophile.dorabaciu.dev
curl -s $SAPI/healthz; echo; curl -s $API/healthz; echo
```

Output:

```
{"status":"ok","db":"ok","commit":"70103b9bd98fd7f7d579e894546c2192a83d3b92"}
{"status":"ok","db":"ok","commit":"70103b9bd98fd7f7d579e894546c2192a83d3b92"}
```

Separation (from section 2 of the setup): the output of
`create-databases.sh` 
Separation line: 

```
Separation check: the staging login tries to open the production database...
ok, refused: permission denied for database "bibliophile_prod"
```

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
   *(screenshot is in evidence/screenshots folder + the curl)*
   Curl: 
   ```bash
    (base) dorabaciu@MacBookPro bibliophile % curl -s $SAPI/healthz
    {"status":"ok","db":"ok","commit":"70103b9bd98fd7f7d579e894546c2192a83d3b92"}%   
   ```
3. Try to release it anyway: Actions → **promote** → that commit's SHA. It
   fails at "Gate: this commit is healthy on staging" ("is not what staging
   is running"). Production never changed: `curl $API/healthz`.
   *(screenshot is in evidence/screenshots folder + the curl)*
   Curl: 
   ```bash
    dorabaciu@MacBookPro bibliophile % curl -s $API/healthz
    {"status":"ok","db":"ok","commit":"70103b9bd98fd7f7d579e894546c2192a83d3b92"}
   ```
   
4. Delete line and commit again. Staging goes green again.


## D4 — CI/CD with SHA + digest, health gate, rollback

- A green `deploy` run and a green `promote` run. Each run's **Summary**
  shows the commit and the image digest. *(screenshots in docs/evidence/screenshots)*
- The gate log lines (`... -> HTTP 200 commit=<sha>` / `Healthy on <sha>`).

  ```
  Gate log lines:
  For deploy:
  04:34:40 https://api.staging.bibliophile.dorabaciu.dev/healthz -> HTTP 200 commit=70103b9bd98fd7f7d579e894546c2192a83d3b92
  04:35:11 https://api.staging.bibliophile.dorabaciu.dev/healthz -> HTTP 200 commit=12af816fdd7e882f07c4a562da0a47bc4ff36835
  Healthy on 12af816fdd7e882f07c4a562da0a47bc4ff36835

  For promote:
  04:53:25 https://api.bibliophile.dorabaciu.dev/healthz -> HTTP 200 commit=70103b9bd98fd7f7d579e894546c2192a83d3b92
  04:53:45 https://api.bibliophile.dorabaciu.dev/healthz -> HTTP 200 commit=12af816fdd7e882f07c4a562da0a47bc4ff36835
  Healthy on 12af816fdd7e882f07c4a562da0a47bc4ff36835
  ```

- **Rollback:** Actions → **rollback** → `production` → the *previous* commit
  (from the last promote summary, "previous commit"). Afterwards
  `curl $API/healthz` shows that older commit. Then **promote** the current
  commit again. *(screenshots in evidence/screenshots+ both curls)*
  Curl from previous:

  ```
  dorabaciu@MacBookPro bibliophile % curl -s $API/healthz; echo
  {"status":"ok","db":"ok","commit":"70103b9bd98fd7f7d579e894546c2192a83d3b92"}
  ```
  Curl from current:

```
  dorabaciu@MacBookPro bibliophile % curl -s $API/healthz; echo
  {"status":"ok","db":"ok","commit":"12af816fdd7e882f07c4a562da0a47bc4ff36835"}
```

## D5 — Reproducible: config in the repo, clean machine

- The deployment is described by files in the repo: `Dockerfile`,
  `.github/workflows/*.yml`, `scripts/deploy/*`, `web/scripts/write-netlify-files.mjs`,
  and the dashboard settings tables in `docs/deployment.md`.
- Clean clone: `git clone <repo> /tmp/clean && cd /tmp/clean`, then follow the
  README "Run it on a clean machine" section. *(paste the last lines of
  `npm test`)*

Last lines:

```
✓ test/seed.test.ts (12 tests) 14770ms
   ✓ seedCatalog / removeSeed (5)
     ✓ adds every sample book once; running it again adds nothing 2053ms
     ✓ sample books show up through the public API, mixed with others, past ones only with past=1 2074ms
     ✓ each sample book has an audit row by system:seed-script and a live event 2099ms
     ✓ remove hides only sample books; imported / hand-added books stay 3394ms
     ✓ seeding after a remove brings them back with dates computed from the NEW today 5107ms
 ✓ test/releaseDate.test.ts (25 tests) 10ms
 ✓ test/observability.test.ts (10 tests) 7ms

 Test Files  13 passed (13)
      Tests  226 passed (226)
   Start at  23:27:19
   Duration  44.89s (tests 92%, import 7%)


> test
> vitest run


 RUN  v5.1.0 /private/tmp/clean/book-release-tracker/web

 ✓ src/format.test.ts (7 tests) 8ms
 ✓ src/useRemote.test.ts (3 tests) 8ms
 ✓ src/pages/WatchlistPage.test.tsx (6 tests) 422ms
 ✓ src/pages/ReleasesPage.test.tsx (12 tests) 697ms
 ✓ src/pages/CuratePage.test.tsx (11 tests) 845ms
 ✓ src/components/ReleaseEditor.test.tsx (11 tests) 1056ms
   ✓ AddReleaseForm (4)
     ✓ adds a release without a Google id, then clears the form and says so 510ms
 ✓ src/pages/ReleasesPage.live.test.tsx (8 tests) 2446ms
   ✓ ReleasesPage — live updates (7)
     ✓ a new release appears without a reload, tagged New, and without a loading flash 622ms
     ✓ a burst of events causes one re-fetch, and a repeated event id is ignored 522ms
     ✓ catalog reads never carry a token (they may be served from a shared cache) 324ms

 Test Files  7 passed (7)
      Tests  58 passed (58)
   Start at  23:28:04
   Duration  5.06s (environment 59%, tests 25%, setup 10%, import 4%, transform 1%, worker 1%)


> test
> vitest run


 RUN  v5.1.0 /private/tmp/clean/book-release-tracker/mcp-app

 ✓ src/CalendarView.test.tsx (11 tests) 477ms
   ✓ CalendarView (8)
     ✓ groups by month, with a year-only group after that year's months 153ms
     ✓ Follow asks first, writes only after Confirm, using the server's token 93ms
     ✓ Cancel (or Escape) sends nothing more 103ms
     ✓ shows the server's error message (e.g. already following) 32ms
     ✓ a network failure becomes an error message, not a crash 32ms
     ✓ a scope refusal (403 insufficient_scope) explains which permission is missing 30ms
     ✓ changing the range asks for a new calendar 25ms
     ✓ empty range -> a helpful empty state 3ms
   ✓ parseResult (3)
     ✓ passes the tool's own error text through 1ms
     ✓ rejects a reply with the wrong shape 1ms
     ✓ accepts a real calendar reply 2ms

 Test Files  1 passed (1)
      Tests  11 passed (11)
   Start at  23:28:10
   Duration  1.61s (environment 48%, tests 34%, setup 10%, import 6%, transform 2%)
```

## D6 — CDN cache policy per content class

```bash
ASSET=$(curl -s $WEB/ | grep -o '/assets/[^"]*\.js' | head -1); echo $ASSET
for i in 1 2; do curl -sI "$WEB$ASSET" | grep -iE "^(cache-control|cache-status|age):"; echo; done
for i in 1 2; do curl -sI "$WEB/" | grep -iE "^(cache-control|cache-status|etag):"; echo; done
ETAG=$(curl -sI "$WEB/" | tr -d '\r' | grep -i '^etag:' | cut -d' ' -f2-)
curl -s -o /dev/null -w "revalidate with ETag -> %{http_code}\n" -H "If-None-Match: $ETAG" "$WEB/"
curl -sI "$API/api/me/watchlist" -H "Authorization: Bearer $READER_TOKEN" | grep -i cache-control
```

Output:

```
age: 0
cache-control: public,max-age=31536000,immutable
cache-status: "Netlify Edge"; fwd=miss; fwd-status=200; stored

age: 0
cache-control: public,max-age=31536000,immutable
cache-status: "Netlify Edge"; fwd=miss; fwd-status=200; stored

cache-control: public,max-age=0,must-revalidate
cache-status: "Netlify Edge"; hit; ttl=31528227
etag: "84eb39e9dd128d0e28e437a246ec0343-ssl"

cache-control: public,max-age=0,must-revalidate
cache-status: "Netlify Edge"; fwd=miss; fwd-status=200; stored
etag: "84eb39e9dd128d0e28e437a246ec0343-ssl"

revalidate with ETag -> 304
cache-control: private, no-store

I then ran the following to check repeated requests for the asset:
book-release-tracker % for i in 1 2 3 4 5; do curl -s -o /dev/null -D - "$WEB$ASSET" | grep -iE "^(cache-status|age):"; echo; done
age: 7910
cache-status: "Netlify Edge"; hit; ttl=31528090

age: 2
cache-status: "Netlify Edge"; fwd=miss; fwd-status=200; stored

age: 4
cache-status: "Netlify Edge"; hit; ttl=31535996

age: 0
cache-status: "Netlify Edge"; fwd=miss; fwd-status=200; stored

age: 5
cache-status: "Netlify Edge"; hit; ttl=31535995
```

What to look for: the asset says `immutable` and its second
request is a **hit**; the HTML says `max-age=0, must-revalidate`; the ETag
request gets **304**; the personal watchlist says `private, no-store`.

**Invalidation:** promote a new commit, then repeat the HTML request. It's a
**miss** with a new ETag (Netlify invalidates on every deploy), then a hit
again. *(paste)*

## D7 — CORS allowlist; security headers

```bash
curl -si -X OPTIONS -H "Origin: $WEB" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: authorization,content-type" "$API/api/me/watchlist" | head -12
curl -si -X OPTIONS -H "Origin: https://evil.example" -H "Access-Control-Request-Method: POST" "$API/api/me/watchlist" | head -12
curl -si -X OPTIONS -H "Origin: $SWEB" -H "Access-Control-Request-Method: POST" "$API/api/me/watchlist" | head -3  
curl -sI $WEB | grep -iE "content-security|strict-transport|x-content-type|referrer-policy|x-frame"
curl -sI $API/healthz | grep -iE "content-security|strict-transport|x-content-type|referrer-policy|x-frame"
```

Output:
```
HTTP/2 204 
date: Sat, 21 Nov 2026 03:20:25 GMT
access-control-allow-headers: Authorization, Content-Type, Last-Event-ID, MCP-Protocol-Version, Mcp-Session-Id
access-control-allow-methods: GET, POST, PATCH, DELETE, OPTIONS
access-control-allow-origin: https://bibliophile.dorabaciu.dev
access-control-expose-headers: X-Request-Id, Retry-After, RateLimit-Limit, RateLimit-Remaining, WWW-Authenticate, Location
access-control-max-age: 600
content-security-policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'
cross-origin-resource-policy: same-site
referrer-policy: no-referrer
rndr-id: eaeb408a-ec26-4abd
server: cloudflare

HTTP/2 403 
date: Sat, 21 Nov 2026 03:20:25 GMT
content-type: application/json; charset=utf-8
content-security-policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'
cross-origin-resource-policy: same-site
etag: W/"99-saG5jLgY16Bajdl6FKLaDGnLhv8"
referrer-policy: no-referrer
rndr-id: f192f6b7-07ac-4486
server: cloudflare
strict-transport-security: max-age=31536000; includeSubDomains
vary: Origin
vary: Accept-Encoding

HTTP/2 403 
date: Sat, 21 Nov 2026 03:20:25 GMT
content-type: application/json; charset=utf-8
content-security-policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://books.google.com; connect-src 'self' https://api.bibliophile.dorabaciu.dev https://login.microsoftonline.com; frame-src https://login.microsoftonline.com; form-action 'self' https://login.microsoftonline.com; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; upgrade-insecure-requests
referrer-policy: strict-origin-when-cross-origin
strict-transport-security: max-age=31536000; includeSubDomains
x-content-type-options: nosniff
x-frame-options: DENY
content-security-policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'
referrer-policy: no-referrer
strict-transport-security: max-age=31536000; includeSubDomains
x-content-type-options: nosniff
x-frame-options: DENY
```

Allowed preflight → **204** naming your site; others → **403**
with no `Access-Control-Allow-Origin`. The staging site is refused by the
production API: the allowlist is exact per environment.

## S1 — Rate limits, live

On **staging** (it costs Google quota, and you don't want test data in
production), with a Test Curator token from the staging site:

```bash
for i in $(seq 1 31); do curl -s -o /dev/null -w "%{http_code} " -H "Authorization: Bearer $CURATOR_TOKEN" "$SAPI/api/books/search?q=dune"; done; echo
curl -si -H "Authorization: Bearer $CURATOR_TOKEN" "$SAPI/api/books/search?q=dune" | grep -iE "^HTTP|retry-after|ratelimit"
```

Output:
```
(base) dorabaciu@MacBookPro book-release-tracker % for i in $(seq 1 31); do curl -s -o /dev/null -w "%{http_code} " -H "Authorization: Bearer $CURATOR_TOKEN" "$SAPI/api/books/search?q=dune"; done; echo
curl -si -H "Authorization: Bearer $CURATOR_TOKEN" "$SAPI/api/books/search?q=dune" | grep -iE "^HTTP|retry-after|ratelimit"
200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200429 
HTTP/2 429 
ratelimit-limit: 30
ratelimit-remaining: 0
retry-after: 55
```

Thirty 200s, then 429 with `Retry-After`. Login is rate-limited by
Entra ID itself (Microsoft's sign-in throttling and lockout). Write routes are
limited per user (watchlist 30/min, curator writes 120/min, MCP 120/min);
`api/test/security.test.ts` shows the 31st watchlist write getting 429.

## Interpretation

_(In your own words: what each piece of output proves. Include the TTL choice,
why a CNAME'd name inherits the main domain's CAA, how the gate stopped the
broken commit at staging, what the rollback changed, why the personal
response isn't cached, and why the staging site is refused by the production
API.)_

D1 
Proves that the domains are correctly configured for deployment, including the CAA records, TTL settings, and that the allowlist for the production API is enforced per environment. The screenshot of porkbun DNS records shows the relevant CAA and TTL settings for the domain including staging and API subdomains. The dig output shows the DNS resolution and confirms the correct propagation of these settings.

D2
Proves that the HTTPS certificate is automatically issued and is set up for auto-renewal by the deployment process as well as ensuring sites are
encrypted. The screenshots are of both netlify and render and show that certificates are correctly issued and managed for both platforms. The curl output confirms that the HTTPS connection is properly established and that the certificate is valid.

D3
Proves that staging and production environments are separate, and that staging requests are correctly refused by the production API due to the environment-specific allowlist. Each /healthz reports its own commit, and the staging login is refused on the production database. I also did a failure: a deliberately broken commit getting stuck on staging and refused by promote, and therefore never reached production.

D4
Proves that Docker image is correctly built and deployed. The /healthz endpoint confirms that the service is running and healthy, indicating that the deployment process successfully built and launched the Docker container. The commit hash reported by /healthz matches the expected deployment, providing further evidence of a correct deployment. The rollback proves that the system can revert to a previous stable state, as it used the previous commit, ensuring reliability and minimizing downtime in case of deployment issues.

D5
Proves that in a new clean tmp directory, project can be rebuilt. All npm tests passed which demonstrates that the project is correctly configured and that the build process is reliable, ensuring that the application can be consistently built and tested in a fresh environment.

D6
Proves that the CDN is correctly serving the deployed content. The curl output shows that requests to the CDN return the miss and then hits, indicating that the content is being properly cached and delivered. This ensures that users receive fast and reliable access to the application through the CDN.

D7
Proves that CORS is correctly configured for the application. The curl output shows that cross-origin requests are either allowed or denied according to the specified CORS policy - site gets 204 for allowed origins and 403 for disallowed origins, ensuring that the application enforces the intended security and access controls for cross-origin requests.

S1
Proves the 30 calls per minute cap is enforced. The evidence shows that when more than 30 200 requests are made within a minute, exceeding the limit, the 31st threw a 429 status code, which demonstrates that the application adheres to the defined rate limit and prevents abuse or overloading of the API.




