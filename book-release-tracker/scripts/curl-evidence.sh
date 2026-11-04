#!/usr/bin/env bash
# F3 evidence: one `curl -i` per route, including the failure cases.
#
# Usage (from the project root, with the API running):
#   scripts/curl-evidence.sh > docs/evidence/curl-$(git rev-parse --short HEAD).txt
#
# Optional environment variables:
#   BASE            API base URL (default http://localhost:3000)
#   READER_TOKEN    access token for the Test Reader user   (after step 3)
#   CURATOR_TOKEN   access token for the Test Curator user  (after step 3)
#
# Without tokens, only the public and 401 cases run; the rest are skipped and
# say so. Tokens are passed in headers and never printed: `curl -i` shows the
# RESPONSE headers only. Still, read the output before committing it.
# Works with the bash 3.2 that ships with macOS.

set -u
BASE="${BASE:-http://localhost:3000}"
READER_TOKEN="${READER_TOKEN:-}"
CURATOR_TOKEN="${CURATOR_TOKEN:-}"
VOL="evidence$(date +%s)"   # fresh volume id each run so the first create is a 201

echo "# curl evidence"
echo "# date:   $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "# commit: $(git rev-parse HEAD 2>/dev/null || echo 'not a git checkout')"
echo "# base:   $BASE"
echo

step() { echo; echo "=================================================================="; echo "## $1"; echo "\$ $2"; echo; }
run()  { curl -sS -i "$@"; echo; }

# ---------------------------------------------------------------- public routes
step "GET /healthz -> 200" "curl -i $BASE/healthz"
run "$BASE/healthz"

step "GET /api/releases -> 200" "curl -i '$BASE/api/releases?limit=5'"
run "$BASE/api/releases?limit=5"

step "GET /api/releases with filters -> 200" "curl -i '$BASE/api/releases?from=2026-11-01&to=2026-12-31&q=the'"
run "$BASE/api/releases?from=2026-11-01&to=2026-12-31&q=the"

step "GET /api/releases unknown parameter -> 400" "curl -i '$BASE/api/releases?form=2026-11-01'"
run "$BASE/api/releases?form=2026-11-01"

step "GET /api/releases impossible date -> 400" "curl -i '$BASE/api/releases?from=2026-02-30'"
run "$BASE/api/releases?from=2026-02-30"

step "GET /api/releases/:id missing -> 404" "curl -i $BASE/api/releases/999999"
run "$BASE/api/releases/999999"

step "GET /api/releases/:id not a number -> 400" "curl -i $BASE/api/releases/abc"
run "$BASE/api/releases/abc"

step "Unknown route -> 404" "curl -i $BASE/api/nope"
run "$BASE/api/nope"

# ------------------------------------------------------------------ 401 cases
step "POST /api/releases anonymous -> 401" "curl -i -X POST -H 'Content-Type: application/json' -d '{...}' $BASE/api/releases"
run -X POST -H "Content-Type: application/json" \
  -d "{\"googleVolumeId\":\"$VOL\",\"title\":\"Evidence Book\",\"publishedDate\":\"2026-12\",\"authors\":[\"Evidence Author\"]}" \
  "$BASE/api/releases"

step "GET /api/me/watchlist anonymous -> 401" "curl -i $BASE/api/me/watchlist"
run "$BASE/api/me/watchlist"

step "GET /api/me/watchlist invalid token -> 401" "curl -i -H 'Authorization: Bearer abc.def.ghi' $BASE/api/me/watchlist"
run -H "Authorization: Bearer abc.def.ghi" "$BASE/api/me/watchlist"

# ------------------------------------------------------------- Reader routes
if [ -z "$READER_TOKEN" ]; then
  echo; echo "## SKIPPED Reader cases: READER_TOKEN not set (available after build step 3)"
else
  R=(-H "Authorization: Bearer $READER_TOKEN")

  step "POST /api/releases as Reader -> 403" "curl -i -X POST -H 'Authorization: Bearer <reader token>' ... $BASE/api/releases"
  run -X POST "${R[@]}" -H "Content-Type: application/json" \
    -d "{\"googleVolumeId\":\"$VOL\",\"title\":\"Evidence Book\",\"publishedDate\":\"2026-12\",\"authors\":[\"Evidence Author\"]}" \
    "$BASE/api/releases"

  step "GET /api/me/watchlist -> 200" "curl -i -H 'Authorization: Bearer <reader token>' $BASE/api/me/watchlist"
  run "${R[@]}" "$BASE/api/me/watchlist"

  step "POST /api/me/watchlist -> 201 + Location" "curl -i -X POST ... -d '{\"authorName\":\"Evidence Author $VOL\"}'"
  CREATED=$(curl -sS -i -X POST "${R[@]}" -H "Content-Type: application/json" \
    -d "{\"authorName\":\"Evidence Author $VOL\"}" "$BASE/api/me/watchlist")
  echo "$CREATED"; echo
  ITEM=$(echo "$CREATED" | tr -d '\r' | sed -n 's#^[Ll]ocation: /api/me/watchlist/##p')

  step "POST /api/me/watchlist same author again -> 409" "curl -i -X POST ... (same body)"
  run -X POST "${R[@]}" -H "Content-Type: application/json" \
    -d "{\"authorName\":\"Evidence Author $VOL\"}" "$BASE/api/me/watchlist"

  step "POST /api/me/watchlist blank name -> 400" "curl -i -X POST ... -d '{\"authorName\":\"  \"}'"
  run -X POST "${R[@]}" -H "Content-Type: application/json" -d '{"authorName":"  "}' "$BASE/api/me/watchlist"

  step "DELETE /api/me/watchlist/$ITEM -> 204" "curl -i -X DELETE ... $BASE/api/me/watchlist/$ITEM"
  run -X DELETE "${R[@]}" "$BASE/api/me/watchlist/$ITEM"

  step "DELETE /api/me/watchlist/$ITEM again -> 404" "curl -i -X DELETE ... $BASE/api/me/watchlist/$ITEM"
  run -X DELETE "${R[@]}" "$BASE/api/me/watchlist/$ITEM"
fi

# ------------------------------------------------------------ Curator routes
if [ -z "$CURATOR_TOKEN" ]; then
  echo; echo "## SKIPPED Curator cases: CURATOR_TOKEN not set (available after build step 3)"
else
  C=(-H "Authorization: Bearer $CURATOR_TOKEN")
  BODY="{\"googleVolumeId\":\"$VOL\",\"title\":\"Evidence Book\",\"publishedDate\":\"2026-12\",\"authors\":[\"Evidence Author\"],\"categories\":[\"Fiction\"]}"

  step "POST /api/releases as Curator -> 201 + Location" "curl -i -X POST -H 'Authorization: Bearer <curator token>' ... $BASE/api/releases"
  CREATED=$(curl -sS -i -X POST "${C[@]}" -H "Content-Type: application/json" -d "$BODY" "$BASE/api/releases")
  echo "$CREATED"; echo
  ID=$(echo "$CREATED" | tr -d '\r' | sed -n 's#^[Ll]ocation: /api/releases/##p')

  step "POST /api/releases same volume -> 409" "curl -i -X POST ... (same body)"
  run -X POST "${C[@]}" -H "Content-Type: application/json" -d "$BODY" "$BASE/api/releases"

  step "POST /api/releases invalid body -> 400" "curl -i -X POST ... -d '{\"title\":\"\",\"publishedDate\":\"2026-02-30\"}'"
  run -X POST "${C[@]}" -H "Content-Type: application/json" -d '{"title":"","publishedDate":"2026-02-30"}' "$BASE/api/releases"

  step "POST /api/releases malformed JSON -> 400" "curl -i -X POST ... -d '{\"title\": '"
  run -X POST "${C[@]}" -H "Content-Type: application/json" -d '{"title": ' "$BASE/api/releases"

  step "GET /api/releases/$ID -> 200" "curl -i $BASE/api/releases/$ID"
  run "$BASE/api/releases/$ID"

  step "PATCH /api/releases/$ID -> 200" "curl -i -X PATCH ... -d '{\"publishedDate\":\"2026-12-15\"}'"
  run -X PATCH "${C[@]}" -H "Content-Type: application/json" -d '{"publishedDate":"2026-12-15"}' "$BASE/api/releases/$ID"

  step "PATCH /api/releases/$ID empty body -> 400" "curl -i -X PATCH ... -d '{}'"
  run -X PATCH "${C[@]}" -H "Content-Type: application/json" -d '{}' "$BASE/api/releases/$ID"

  step "PATCH /api/releases/999999 -> 404" "curl -i -X PATCH ... $BASE/api/releases/999999"
  run -X PATCH "${C[@]}" -H "Content-Type: application/json" -d '{"title":"X"}' "$BASE/api/releases/999999"

  step "DELETE /api/releases/$ID -> 204" "curl -i -X DELETE ... $BASE/api/releases/$ID"
  run -X DELETE "${C[@]}" "$BASE/api/releases/$ID"

  step "DELETE /api/releases/$ID again -> 404" "curl -i -X DELETE ... $BASE/api/releases/$ID"
  run -X DELETE "${C[@]}" "$BASE/api/releases/$ID"
fi
