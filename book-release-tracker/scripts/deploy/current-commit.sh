#!/usr/bin/env bash
# Prints the commit an API is serving now (from /healthz), or nothing.
#   current-commit.sh <api-url>
set -uo pipefail
curl -sS --max-time 90 "${1:?api url}/healthz" 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).commit??"")}catch{}})'
