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

With the index: `Index Scan using books_published_date_idx` and an
`Index Cond` on `published_date`. Without it: `Seq Scan on books`, which
reads all 50,000 rows. When I (AI) ran step 2 during development the plan was:

```
Index Scan using books_published_date_idx on books b  (cost=0.29..37.29 rows=140 width=8)
  Index Cond: ((published_date > '2099-01-01 00:00:00') AND (published_date <= '2100-03-01'))
  Filter: ((NOT hidden) AND (CASE date_precision ... END >= '2100-01-01'))
```

## My output (commit `_______`, date `_______`)

```
(paste here)
```

## My interpretation

_(In your own words: what the plan shows, and the before/after timings.)_
