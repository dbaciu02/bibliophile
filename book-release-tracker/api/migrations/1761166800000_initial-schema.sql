-- Up Migration

-- How precise a release date is. Google Books returns "2026", "2026-11" or
-- "2026-11-04"; we store the first day of the period plus this precision.
CREATE TYPE date_precision AS ENUM ('year', 'month', 'day');

-- People who have signed in through Entra ID. Roles are NOT stored here:
-- they come from the validated access token on every request (F9).
CREATE TABLE users (
  id            bigserial PRIMARY KEY,
  idp_subject   text        NOT NULL UNIQUE,  -- Entra "oid" claim
  display_name  text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE authors (
  id    bigserial PRIMARY KEY,
  name  text NOT NULL UNIQUE
);

-- The curated release catalog.
CREATE TABLE books (
  id                bigserial PRIMARY KEY,
  google_volume_id  text           NOT NULL UNIQUE,  -- duplicate import -> 409
  title             text           NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  published_date    date           NOT NULL,
  date_precision    date_precision NOT NULL,
  categories        text[]         NOT NULL DEFAULT '{}',
  thumbnail_url     text,
  hidden            boolean        NOT NULL DEFAULT false,
  created_at        timestamptz    NOT NULL DEFAULT now(),
  updated_at        timestamptz    NOT NULL DEFAULT now()
);

-- Justified index (F4): every calendar/upcoming query is a range scan on
-- published_date ("releases between from and to"). Without this index that
-- is a full table scan on every page load of the public page.
CREATE INDEX books_published_date_idx ON books (published_date);

CREATE TABLE book_authors (
  book_id    bigint NOT NULL REFERENCES books (id)   ON DELETE CASCADE,
  author_id  bigint NOT NULL REFERENCES authors (id) ON DELETE CASCADE,
  PRIMARY KEY (book_id, author_id)
);
-- "All books by this author" (watchlist matching) looks up by author_id.
CREATE INDEX book_authors_author_id_idx ON book_authors (author_id);

-- A reader following an author. One row per (user, author): a second add -> 409.
CREATE TABLE watchlist_items (
  id          bigserial PRIMARY KEY,
  user_id     bigint      NOT NULL REFERENCES users (id)   ON DELETE CASCADE,
  author_id   bigint      NOT NULL REFERENCES authors (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, author_id)
);

-- Append-only audit trail (F6). actor_subject comes from the validated token.
CREATE TABLE audit_log (
  id             bigserial   PRIMARY KEY,
  at             timestamptz NOT NULL DEFAULT now(),
  actor_subject  text        NOT NULL,
  actor_role     text        NOT NULL,
  action         text        NOT NULL,   -- e.g. 'release.create', 'mcp.add_to_watchlist'
  entity_type    text        NOT NULL,
  entity_id      text        NOT NULL,
  before         jsonb,                   -- null on create
  after          jsonb,                   -- null on delete
  request_id     text        NOT NULL
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);

-- Enforce append-only in the database itself, not just in app code.
-- A trigger is used instead of REVOKE because REVOKE does not apply to the
-- table owner, and the app connects as the owner.
CREATE FUNCTION audit_log_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_reject_change();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_reject_change();

-- Live-update events (F11). The bigserial id doubles as the SSE event id, so a
-- reconnecting client sends Last-Event-ID and gets exactly what it missed.
CREATE TABLE events (
  id          bigserial   PRIMARY KEY,
  type        text        NOT NULL,
  payload     jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Down Migration

DROP TABLE events;
DROP TRIGGER audit_log_no_truncate ON audit_log;
DROP TRIGGER audit_log_append_only ON audit_log;
DROP TABLE audit_log;
DROP FUNCTION audit_log_reject_change();
DROP TABLE watchlist_items;
DROP TABLE book_authors;
DROP TABLE books;
DROP TABLE authors;
DROP TABLE users;
DROP TYPE date_precision;
