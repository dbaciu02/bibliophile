#!/usr/bin/env bash
# Deploy gate (D4): wait until <api-url>/healthz answers 200 with "commit": <sha>.
#   wait-healthy.sh <api-url> <sha> [timeout-seconds]
# Passing means the NEW build is the one serving traffic and it can reach its
# database. A free Render service may first need ~1 minute to wake up.
set -euo pipefail
url="${1:?api url}/healthz"; sha="${2:?commit sha}"; timeout="${3:-600}"
deadline=$(( $(date +%s) + timeout )); last=""
while [ "$(date +%s)" -lt "$deadline" ]; do
  body=$(curl -sS --max-time 20 -w '\n%{http_code}' "$url" 2>/dev/null || true)
  code=$(printf '%s' "$body" | tail -n1); json=$(printf '%s' "$body" | sed '$d')
  commit=$(printf '%s' "$json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).commit??"")}catch{}})')
  now="HTTP ${code:-000} commit=${commit:-?}"
  [ "$now" != "$last" ] && echo "$(date -u +%H:%M:%S) $url -> $now"; last="$now"
  if [ "$code" = "200" ] && [ "$commit" = "$sha" ]; then echo "Healthy on $sha"; exit 0; fi
  sleep 10
done
echo "::error::$url did not report a healthy $sha within ${timeout}s (last: $last)"; exit 1
