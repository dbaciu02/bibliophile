# D6 evidence, part 2: the public API class through the CDN

Part 1 (hashed assets, HTML, personal API responses) is in
[deployment.md](deployment.md#d6--cdn-cache-policy-per-content-class). This
part covers the fourth content class the requirement names: the **public
API**. 

Browsers read the catalog from the **site's own origin**
(`$WEB/api/releases…`); Netlify proxies it to the API and keeps a 200 for
60 s, keyed by path and query string. Personal routes are not proxied.

```bash
WEB=https://bibliophile.dorabaciu.dev
U="$WEB/api/releases?limit=20&x=1"
for i in 1 2 3; do curl -sI "$U" | tr -d '\r' | grep -iE "^(cache-control|cache-status|age|etag):"; echo; sleep 2; done
```

Output 1:
```
age: 1
cache-status: "Netlify Edge"; fwd=miss; fwd-status=400
etag: W/"bb-+YjjvuAe2eWAB7xZo+0XJje2Xxw"

age: 0
cache-status: "Netlify Edge"; fwd=miss; fwd-status=400
etag: W/"bb-pTNtRdXqQFoeWpmORYc0xj3Vw3Y"

age: 1
cache-status: "Netlify Edge"; fwd=miss; fwd-status=400
etag: W/"bb-aBNclkgH+U9RBWhhvl5z3+GmKxQ"

```

Output 2:
```
```

Output 3:
```
```

What to look for: the first request says `fwd=miss` (if someone
else just loaded the page it may already be a `hit`: add `&x=1` to the
`limit=20` for a fresh key), the next ones say **hit** with a growing `Age`;
`Cache-Control` toward the browser is `public, max-age=0, must-revalidate`;
the ETag request gets **304**; the personal route returns the app's HTML
(`text/html`), not data: it is never proxied, so it can't be shared-cached.

**Invalidation, three ways** (paste each):

1. *By time:* wait 60 s and repeat: `fwd=stale` or `fwd=miss`, then hit again.
2. *By change:* with the site open in a browser (DevTools → Network, filter
   `releases`), change a release on the Curate page. The list refetches
   `…&v=<event id>`: a key the CDN has never seen, so it's a **miss** with
   the change in it. Screenshot the request and its `Cache-Status`.
3. *On demand:* Actions → **purge-cache** → Run workflow → `staging` (or
   `production`). It purges the `releases` cache tag; its summary shows the
   next request is a **miss**. Repeat the curl loop above: miss, then hit.
