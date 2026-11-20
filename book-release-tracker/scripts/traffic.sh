#!/usr/bin/env bash
# Steady, gentle traffic against one API, for the Game Day and for the SLO
# dashboard (D10, S2). One public read per second; prints a status line every
# 10 seconds so you can see the moment things break and recover.
#   scripts/traffic.sh <api-url> [minutes, default 20]
# Public reads only: no token, no writes, no Google quota used.
set -uo pipefail
api="${1:?api url, e.g. https://api.staging.bibliophile.example.com}"; minutes="${2:-20}"
end=$(( $(date +%s) + minutes * 60 )); ok=0; bad=0; n=0
echo "time      ok  5xx/err  last status  (Ctrl+C to stop)"
while [ "$(date +%s)" -lt "$end" ]; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$api/api/releases?limit=5" || echo 000)
  if [ "${code:0:1}" = "2" ]; then ok=$((ok+1)); else bad=$((bad+1)); fi
  n=$((n+1))
  if [ $((n % 10)) -eq 0 ]; then printf '%s  %3d  %3d      %s\n' "$(date +%H:%M:%S)" "$ok" "$bad" "$code"; ok=0; bad=0; fi
  sleep 1
done
