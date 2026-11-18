-- Up Migration

-- One-time confirmation codes for MCP write tools (F12).
-- The first call to a write tool only creates a row here and returns its
-- token; the write happens on a second call that presents the token. A token
-- is single-use, expires after a few minutes, and only works for the same
-- user, tool and arguments it was issued for.
CREATE TABLE mcp_confirmations (
  token       text        PRIMARY KEY,           -- 32 random bytes, base64url
  subject     text        NOT NULL,              -- token owner (Entra oid)
  tool        text        NOT NULL,              -- e.g. 'add_to_watchlist'
  args        jsonb       NOT NULL,              -- the exact arguments being confirmed
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz                        -- set when consumed; never reused
);

-- Down Migration

DROP TABLE mcp_confirmations;
