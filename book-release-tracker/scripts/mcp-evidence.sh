#!/usr/bin/env bash
# F12 evidence: the MCP endpoint over plain HTTP, including the refusals.
#
# Usage (from the project root, with the API running):
#   scripts/mcp-evidence.sh > docs/evidence/mcp-curl-$(git rev-parse --short HEAD).txt
#
# Optional environment variables:
#   BASE             API base URL (default http://localhost:3000)
#   READER_TOKEN     Test Reader token from the website (Releases.Read + Watchlist.ReadWrite)
#   READONLY_TOKEN   a token with ONLY Releases.Read (docs/entra-id-setup.md, section 8)
#
# Get tokens exactly as for scripts/curl-evidence.sh (copy(...) in DevTools,
# then  export READER_TOKEN=$(pbpaste)). Tokens go in request headers and are
# never printed. Still, read the output before committing it.
#
# MCP replies may come back as a one-message event stream
# ("event: message" / "data: {...}"); that is normal for Streamable HTTP.

set -u
BASE="${BASE:-http://localhost:3000}"
READER_TOKEN="${READER_TOKEN:-}"
READONLY_TOKEN="${READONLY_TOKEN:-}"

echo "# MCP evidence"
echo "# date:   $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "# commit: $(git rev-parse HEAD 2>/dev/null || echo 'not a git checkout')"
echo "# base:   $BASE"

step() { echo; echo "=================================================================="; echo "## $1"; echo "\$ $2"; echo; }
H=(-H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -H "MCP-Protocol-Version: 2025-06-18")
rpc() { # rpc <token-or-empty> <json body> [extra curl args...]
  local tok="$1" body="$2"; shift 2
  if [ -n "$tok" ]; then
    curl -sS -i -X POST "${H[@]}" -H "Authorization: Bearer $tok" "$@" -d "$body" "$BASE/mcp"
  else
    curl -sS -i -X POST "${H[@]}" "$@" -d "$body" "$BASE/mcp"
  fi
  echo
}
call() { printf '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"%s","arguments":%s}}' "$1" "$2"; }

step "Protected-resource metadata (RFC 9728) -> 200" "curl -i $BASE/.well-known/oauth-protected-resource/mcp"
curl -sS -i "$BASE/.well-known/oauth-protected-resource/mcp"; echo

step "tools/list without a token -> 401 + WWW-Authenticate with resource_metadata" "curl -i -X POST ... $BASE/mcp"
rpc "" '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

step "tools/list with a garbage token -> 401 invalid_token" "curl -i -X POST -H 'Authorization: Bearer not-a-jwt' ... $BASE/mcp"
rpc "not-a-jwt" '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

step "Foreign Host header -> 403 (DNS-rebinding guard)" "curl -i -X POST -H 'Host: evil.example' ... $BASE/mcp"
rpc "" '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' -H "Host: evil.example"

if [ -z "$READER_TOKEN" ]; then
  echo; echo "## (READER_TOKEN not set: skipping the signed-in calls)"
else
  step "tools/list as Test Reader -> 200, six tools" "curl -i -X POST -H 'Authorization: Bearer \$READER_TOKEN' ... tools/list"
  rpc "$READER_TOKEN" '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

  step "search_releases -> 200" "tools/call search_releases {\"limit\":3}"
  rpc "$READER_TOKEN" "$(call search_releases '{"limit":3}')"

  step "add_to_watchlist WITHOUT a confirmation token -> confirmation_required, nothing written" \
       "tools/call add_to_watchlist {\"authorName\":\"Evidence Author MCP\"}"
  rpc "$READER_TOKEN" "$(call add_to_watchlist '{"authorName":"Evidence Author MCP"}')"

  step "add_to_watchlist with a made-up confirmation token -> isError, nothing written" \
       "tools/call add_to_watchlist {\"authorName\":\"Evidence Author MCP\",\"confirmationToken\":\"madeUpToken000…\"}"
  rpc "$READER_TOKEN" "$(call add_to_watchlist '{"authorName":"Evidence Author MCP","confirmationToken":"madeUpToken0000000000000000000000000000000"}')"
fi

if [ -z "$READONLY_TOKEN" ]; then
  echo; echo "## (READONLY_TOKEN not set: skipping the read-only token checks)"
else
  step "Read-only token: search_releases -> 200" "tools/call search_releases with \$READONLY_TOKEN"
  rpc "$READONLY_TOKEN" "$(call search_releases '{"limit":1}')"

  step "Read-only token: add_to_watchlist -> 403 insufficient_scope (step-up challenge)" \
       "tools/call add_to_watchlist with \$READONLY_TOKEN"
  rpc "$READONLY_TOKEN" "$(call add_to_watchlist '{"authorName":"Evidence Author MCP"}')"

  step "Read-only token: get_my_watchlist -> 403 insufficient_scope" "tools/call get_my_watchlist with \$READONLY_TOKEN"
  rpc "$READONLY_TOKEN" "$(call get_my_watchlist '{}')"
fi
