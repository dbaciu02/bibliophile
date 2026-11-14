-- Up Migration

-- Cache of Google Books responses (F10). Keyed by the request we made, so the
-- same search or volume lookup within its TTL costs no quota. Expired rows are
-- kept on purpose: when Google is down, the API serves them marked as stale
-- instead of failing (graceful degradation).
CREATE TABLE google_books_cache (
  cache_key   text        PRIMARY KEY,           -- e.g. 'search:q=dune' or 'volume:abc123'
  body        jsonb       NOT NULL,              -- the validated response we stored
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

-- Down Migration

DROP TABLE google_books_cache;
