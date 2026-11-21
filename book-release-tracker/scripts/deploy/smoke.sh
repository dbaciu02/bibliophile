#!/usr/bin/env bash
# Post-deploy smoke checks for one environment.
#   smoke.sh <web-url> <api-url>
# - the site loads over HTTPS with its security headers
# - the API answers the site's CORS preflight (204) and refuses another origin (403)
# - a public API read works, directly and through the site's CDN proxy (D6)
# - personal routes are NOT proxied through the site (they never reach the CDN)
set -euo pipefail
web="${1:?web url}"; api="${2:?api url}"; fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1 ($2)"; else echo "::error::$1: expected $3, got $2"; fail=1; fi; }

code=$(curl -sS -o /dev/null -w '%{http_code}' "$web/"); check "site loads" "$code" 200
csp=$(curl -sSI "$web/" | tr -d '\r' | grep -i '^content-security-policy:' | grep -c "$api" || true); check "site CSP allows this API" "$csp" 1
code=$(curl -sS -o /dev/null -w '%{http_code}' "$web/watchlist"); check "deep link (SPA fallback)" "$code" 200
code=$(curl -sS -o /dev/null -w '%{http_code}' -X OPTIONS -H "Origin: $web" -H 'Access-Control-Request-Method: GET' "$api/api/releases"); check "CORS preflight from the site" "$code" 204
code=$(curl -sS -o /dev/null -w '%{http_code}' -X OPTIONS -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: GET' "$api/api/releases"); check "CORS preflight from another origin" "$code" 403
code=$(curl -sS -o /dev/null -w '%{http_code}' "$api/api/releases?limit=1"); check "public read" "$code" 200
code=$(curl -sS -o /dev/null -w '%{http_code}' "$api/api/me"); check "protected route without token" "$code" 401
type=$(curl -sS -o /dev/null -w '%{http_code} %{content_type}' "$web/api/releases?limit=1" | cut -d';' -f1); check "catalog through the site's CDN" "$type" "200 application/json"
cdn=$(curl -sSI "$web/api/releases?limit=1" | tr -d '\r' | grep -ci '^netlify-cdn-cache-control:\|^cache-status:' || true); [ "$cdn" -ge 1 ] && cdn=yes || cdn=no; check "catalog response carries CDN cache headers" "$cdn" yes
type=$(curl -sS -o /dev/null -w '%{content_type}' "$web/api/me/watchlist" | cut -d';' -f1); check "personal route not proxied (gets the app, not data)" "$type" "text/html"
exit $fail
