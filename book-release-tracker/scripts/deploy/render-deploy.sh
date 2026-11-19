#!/usr/bin/env bash
# Ask Render to deploy one exact image.
#   render-deploy.sh <deploy-hook-url> <image-ref>
# image-ref: ghcr.io/owner/bibliophile-api@sha256:... (or :sha-<commit> for a rollback)
# The hook URL is a secret (it alone can deploy): it comes from a GitHub
# environment secret and is never printed.
set -euo pipefail
hook="${1:?deploy hook url}"; image="${2:?image ref}"
encoded=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$image")
echo "Requesting Render deploy of $image"
code=$(curl -sS -o /tmp/render-deploy.out -w '%{http_code}' -X POST "${hook}&imgURL=${encoded}")
if [ "$code" != "200" ] && [ "$code" != "201" ] && [ "$code" != "202" ]; then
  echo "::error::Render refused the deploy (HTTP $code)"; cat /tmp/render-deploy.out; echo; exit 1
fi
echo "Render accepted the deploy (HTTP $code): $(cat /tmp/render-deploy.out)"
