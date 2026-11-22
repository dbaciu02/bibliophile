# D6 evidence, part 2: the public API class through the CDN

Part 1 (hashed assets, HTML, personal API responses) is in
[deployment.md](deployment.md#d6--cdn-cache-policy-per-content-class). This
part covers the fourth content class the requirement names: the **public
API**. 

Browsers read the catalog from the **site's own origin**
(`$WEB/api/releases…`); Netlify proxies it to the API and keeps a 200 for
60 s, keyed by path and query string. Personal routes are not proxied.

Commit: 12af816fdd7e882f07c4a562da0a47bc4ff36835 date: 2026-11-21

```bash
WEB=https://bibliophile.dorabaciu.dev
U="$WEB/api/releases?limit=20&x=1"
for i in 1 2 3; do curl -sI "$U" | tr -d '\r' | grep -iE "^(cache-control|cache-status|age|etag):"; echo; sleep 2; done

U="$WEB/api/releases?limit=20&v=1001"
curl -s -w '%{http_code}  %header{cache-status}  age=%header{age}\n' \
  -o /dev/null -o /dev/null -o /dev/null -o /dev/null -o /dev/null \
  "$U" "$U" "$U" "$U" "$U"
```

What to look for: the first request says `fwd=miss` (if someone
else just loaded the page it may already be a `hit`: add `&x=1` to the
`limit=20` for a fresh key), the next ones say **hit** with a growing `Age`;
`Cache-Control` toward the browser is `public, max-age=0, must-revalidate`;
the ETag request gets **304**; the personal route returns the app's HTML
(`text/html`), not data: it is never proxied, so it can't be shared-cached.

First run:
```
U="$WEB/api/releases?limit=20&v=1001"
for i in 1 2 3 4 5; do curl -s -o /dev/null -D - "$U" | tr -d '\r' | grep -iE "^(cache-control|cache-status|age|etag):"; echo; sleep 2; done
age: 0
cache-control: public,max-age=0,must-revalidate
cache-status: "Netlify Edge"; fwd=miss; fwd-status=200; stored
etag: W/"16c6-qw9jnrdZXyBcP8+hEMY+JDxViLA"

age: 0
cache-control: public,max-age=0,must-revalidate
cache-status: "Netlify Edge"; fwd=miss; fwd-status=200; stored
etag: W/"16c6-qw9jnrdZXyBcP8+hEMY+JDxViLA"

age: 1
cache-control: public,max-age=0,must-revalidate
cache-status: "Netlify Edge"; fwd=miss; fwd-status=200; stored
etag: W/"16c6-qw9jnrdZXyBcP8+hEMY+JDxViLA"

age: 0
cache-control: public,max-age=0,must-revalidate
cache-status: "Netlify Edge"; fwd=miss; fwd-status=200; stored
etag: W/"16c6-qw9jnrdZXyBcP8+hEMY+JDxViLA"

age: 0
cache-control: public,max-age=0,must-revalidate
cache-status: "Netlify Edge"; fwd=miss; fwd-status=200; stored
etag: W/"16c6-qw9jnrdZXyBcP8+hEMY+JDxViLA"
```

Separate connections land on different Netlify edge servers, each with its own cache (miss + stored each time); on one connection the same server answers and the second request onward is a hit
```
curl -s -w '%{http_code}  %header{cache-status}  age=%header{age}\n' \
  -o /dev/null -o /dev/null -o /dev/null -o /dev/null -o /dev/null \
  "$U" "$U" "$U" "$U" "$U"
200  "Netlify Edge"; fwd=miss; fwd-status=200; stored  age=0
200  "Netlify Edge"; hit; ttl=60  age=0
200  "Netlify Edge"; hit; ttl=60  age=0
200  "Netlify Edge"; hit; ttl=60  age=0
200  "Netlify Edge"; hit; ttl=60  age=0
```

304, personal route isn't proxied:
```
ETAG=$(curl -s -o /dev/null -D - "$U" | tr -d '\r' | grep -i '^etag:' | cut -d' ' -f2-)
curl -s -o /dev/null -w "revalidate with ETag -> %{http_code}\n" -H "If-None-Match: $ETAG" "$U"
curl -s -o /dev/null -w "personal route on the site -> %{http_code} %{content_type}\n" "$WEB/api/me/watchlist"

revalidate with ETag -> 304
personal route on the site -> 200 text/html; charset=UTF-8
```

**Invalidation, three ways** (paste each):

1. *By time:* wait 60 s and repeat: `fwd=stale` or `fwd=miss`, then hit again.
```
U="$WEB/api/releases?limit=20&v=1001"
curl -s -w '%{http_code}  %header{cache-status}  age=%header{age}\n' \
  -o /dev/null -o /dev/null -o /dev/null -o /dev/null -o /dev/null \
  "$U" "$U" "$U" "$U" "$U"

200  "Netlify Edge"; fwd=miss; fwd-status=200; stored  age=0
200  "Netlify Edge"; hit; ttl=60  age=0
200  "Netlify Edge"; hit; ttl=60  age=0
200  "Netlify Edge"; hit; ttl=59  age=1
200  "Netlify Edge"; hit; ttl=59  age=1
```
2. *By change:* with the site open in a browser (DevTools → Network, filter
   `releases`), sign in as a curator and click Edit on a release, change its title and save. 
   The list refetches `…&v=<event id>`: a key the CDN has never seen, so it's a **miss** with
   the change in it. Screenshot the request and its `Cache-Status`.
3. *On demand:* Actions → **purge-cache** → Run workflow → `staging` (or
   `production`). It purges the `releases` cache tag; its summary shows the
   next request is a **miss**. Repeat the curl loop above: miss, then hit.

Step 3 screenshot: `docs/evidence/screenshots/D6-step-3-purge.png`
```
curl -s -w '%{http_code}  %header{cache-status}  age=%header{age}\n' \
  -o /dev/null -o /dev/null -o /dev/null \
  "$U" "$U" "$U"

200  "Netlify Edge"; fwd=miss; fwd-status=200; stored  age=0
200  "Netlify Edge"; hit; ttl=60  age=0
200  "Netlify Edge"; hit; ttl=60  age=0
```
The first request after the purge is a miss, and subsequent requests are hits, demonstrating the CDN's behavior in serving fresh content after an on-demand invalidation.


**Note for step 2:**
Screenshot: `docs/evidence/screenshots/D6-step-2.png`
I edited the title as the curator, and the other window refetched by itself with a new v= key, without a reload
both of its requests were hits, yet the response already had the new title. This happened because the curator’s window fetched the new key first (the miss) and the CDN stored that fresh copy, so stale data is never served after a change and the API is asked once per change.