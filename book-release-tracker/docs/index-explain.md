# F4 — justifying `books_published_date_idx`

**Claim:** the public calendar query (`GET /api/releases?from=…&to=…`) is a
range scan on `books.published_date`, so an index on that column lets Postgres
read only the matching rows instead of the whole table.

**Subtlety:** the `from` filter compares the *end* of each release's period
(a computed expression), which an index on `published_date` can't serve on its
own. The query therefore adds a second, equivalent bound,
`published_date > from - 1 year` (no period is longer than a year), which the
index *can* use. See `listReleases()` in `api/src/repositories/releases.ts`.

## Reproduce (run it yourself and paste YOUR output below)

```bash
# 1. Put 50,000 synthetic rows in the test database
psql postgres://app:app@localhost:5433/booktracker_test -c "
  INSERT INTO books (google_volume_id, title, published_date, date_precision)
  SELECT 'x' || g, 't' || g, date '2000-01-01' + g, 'day' FROM generate_series(1, 50000) g;
  ANALYZE books;"

# 2. Ask Postgres how it would run the calendar query
psql postgres://app:app@localhost:5433/booktracker_test -c "
  EXPLAIN ANALYZE SELECT id FROM books b
  WHERE NOT b.hidden
    AND (CASE b.date_precision
           WHEN 'day'   THEN b.published_date
           WHEN 'month' THEN (date_trunc('month', b.published_date) + interval '1 month - 1 day')::date
           ELSE              (date_trunc('year',  b.published_date) + interval '1 year - 1 day')::date
         END) >= date '2100-01-01'
    AND b.published_date > date '2100-01-01' - interval '1 year'
    AND b.published_date <= date '2100-03-01';"

# 3. Same query without the index, for comparison
psql postgres://app:app@localhost:5433/booktracker_test -c "
  BEGIN; DROP INDEX books_published_date_idx;
  EXPLAIN ANALYZE SELECT id FROM books b WHERE NOT b.hidden
    AND b.published_date > date '2099-01-01' AND b.published_date <= date '2100-03-01';
  ROLLBACK;"
```

The next `npm test` run resets the test database, so the 50,000 rows don't
need cleaning up. Step 3 rolls back, so the index is not really dropped.

## Expected

```
Index Scan using books_published_date_idx on books b  (cost=0.29..37.29 rows=140 width=8)
  Index Cond: ((published_date > '2099-01-01 00:00:00') AND (published_date <= '2100-03-01'))
  Filter: ((NOT hidden) AND (CASE date_precision ... END >= '2100-01-01'))
```

## My output (commit `_______`, date `11-21-2026`)

```
book-release-tracker % >....                                              
  EXPLAIN ANALYZE SELECT id FROM books b
  WHERE NOT b.hidden
    AND (CASE b.date_precision
           WHEN 'day'   THEN b.published_date
           WHEN 'month' THEN (date_trunc('month', b.published_date) + interval '1 month - 1 day')::date
           ELSE              (date_trunc('year',  b.published_date) + interval '1 year - 1 day')::date 
         END) >= date '2100-01-01'
    AND b.published_date > date '2100-01-01' - interval '1 year'
    AND b.published_date <= date '2100-03-01';"
                                                                                   QUERY PLAN                                                                          
--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Index Scan using books_published_date_idx on books b  (cost=0.29..35.34 rows=134 width=8) (actual time=0.220..0.864 rows=60 loops=1)
   Index Cond: ((published_date > '2099-01-01 00:00:00'::timestamp without time zone) AND (published_d
ate <= '2100-03-01'::date))
   Filter: ((NOT hidden) AND (CASE date_precision WHEN 'day'::date_precision THEN published_date WHEN'month'::date_precision THEN ((date_trunc('month'::text, (published_date)::timestamp with time zone) + '1 mon -1 days'::interval))::date ELSE ((date_trunc('year'::text, (published_date)::timestamp with time zone) + '1 year -1 days'::interval))::date END >= '2100-01-01'::date))
   Rows Removed by Filter: 364
 Planning Time: 0.409 ms
 Execution Time: 1.379 ms
(6 rows)

psql postgres://app:app@localhost:5433/booktracker_test \
  -c "BEGIN" \
  -c "DROP INDEX books_published_date_idx" \
  -c "EXPLAIN ANALYZE SELECT id FROM books b WHERE NOT b.hidden AND b.published_date > date '2099-01-01' AND b.published_date <= date '2100-03-01'" \
  -c "ROLLBACK"
BEGIN
DROP INDEX
                                                  QUERY PLAN         
---------------------------------------------------------------------------------------------------------------
 Seq Scan on books b  (cost=0.00..1368.00 rows=401 width=8) (actual time=4.470..11.223 rows=424 loops=1)
   Filter: ((NOT hidden) AND (published_date > '2099-01-01'::date) AND (published_date <= '2100-03-01'::date))
   Rows Removed by Filter: 49576
:...skipping...
                                                  QUERY PLAN         
---------------------------------------------------------------------------------------------------------------
 Seq Scan on books b  (cost=0.00..1368.00 rows=401 width=8) (actual time=4.470..11.223 rows=424 loops=1)
   Filter: ((NOT hidden) AND (published_date > '2099-01-01'::date) AND (published_date <= '2100-03-01'::date))
   Rows Removed by Filter: 49576
 Planning Time: 0.324 ms
 Execution Time: 15.811 ms
:...skipping...
                                                  QUERY PLAN         
---------------------------------------------------------------------------------------------------------------
 Seq Scan on books b  (cost=0.00..1368.00 rows=401 width=8) (actual time=4.470..11.223 rows=424 loops=1)
   Filter: ((NOT hidden) AND (published_date > '2099-01-01'::date) AND (published_date <= '2100-03-01'::date))
   Rows Removed by Filter: 49576
 Planning Time: 0.324 ms
 Execution Time: 15.811 ms
(5 rows)

~
~
~
~
~
~
~
~
~
~
(END)...skipping...
                                                  QUERY PLAN         
---------------------------------------------------------------------------------------------------------------
 Seq Scan on books b  (cost=0.00..1368.00 rows=401 width=8) (actual time=4.470..11.223 rows=424 loops=1)
   Filter: ((NOT hidden) AND (published_date > '2099-01-01'::date) AND (published_date <= '2100-03-01'::date))
   Rows Removed by Filter: 49576
 Planning Time: 0.324 ms
 Execution Time: 15.811 ms
(5 rows)

~
~
~
~
~
~
~
~
~
~
~
~
~
~
ROLLBACK
```

## My interpretation
The initial part of the output shows the query plan for the SELECT statement, including the index scan on the `books` table and the filter applied to the rows.

Each query plan shows the execution of a SELECT statement on the `books` table, filtering for books that are not hidden and have a published date within the specified range. The plan indicates that a sequential scan is performed on the table, and the filter is applied to remove rows that do not match the criteria. The timings show the planning and execution times for the query, with the number of rows removed by the filter and the actual number of rows returned. The output ends with rollback, indicating that any changes made during the transaction are not persisted.

The schema (primary keys, foreign keys, indexes) is in the ER diagram in
[architecture.md](../architecture.md), section 3.

# F5 — Migrations: down and up

Migration files: `api/migrations/` (node-pg-migrate, each with Up and Down).
`api/test/migrations.test.ts` tests all up, the newest down and up alone,
then all down.


```
npm run migrate:down

> migrate:down
> npm run migrate:down --workspace api


> migrate:down
> node-pg-migrate down --migrations-dir migrations --envPath .env

> Migrating files:
> - 1763424000000_mcp-confirmations
### MIGRATION 1763424000000_mcp-confirmations (DOWN) ###

-- Down Migration

DROP TABLE mcp_confirmations;
;
DELETE FROM "public"."pgmigrations" WHERE name='1763424000000_mcp-confirmations';


Migrations complete!
```

```
npm run migrate:up  

> migrate:up
> npm run migrate:up --workspace api


> migrate:up
> node-pg-migrate up --migrations-dir migrations --envPath .env

> Migrating files:
> - 1763424000000_mcp-confirmations
### MIGRATION 1763424000000_mcp-confirmations (UP) ###
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
;
INSERT INTO "public"."pgmigrations" (name, run_on) VALUES ('1763424000000_mcp-confirmations', NOW());


Migrations complete!
```
i
What this shows: The migration system correctly handles both down and up migrations. Running `migrate:down` removes the `mcp_confirmations` table and deletes the corresponding entry from the `pgmigrations` table, while running `migrate:up` recreates the table and records the migration in `pgmigrations`. This ensures that database schema changes can be applied and reverted reliably, maintaining the integrity and consistency of the database schema.
