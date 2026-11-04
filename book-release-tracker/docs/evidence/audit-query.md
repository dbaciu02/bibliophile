# F6 — audit trail query output

**Claim:** every write records who (from the validated token), what, when, and
the before/after state, and the table can't be changed afterwards.

## Reproduce

After running `scripts/curl-evidence.sh` with tokens (from step 3 on), or after
using the app:

```bash
psql postgres://app:app@localhost:5433/booktracker -c "
  SELECT id, at, actor_subject, actor_role, action, entity_type, entity_id,
         before->>'title' AS before_title, after->>'title' AS after_title, request_id
    FROM audit_log ORDER BY id DESC LIMIT 10;"
```

Then prove it is append-only (each must fail with
`audit_log is append-only (... rejected)`):

```bash
psql postgres://app:app@localhost:5433/booktracker -c "UPDATE audit_log SET action = 'tampered';"
psql postgres://app:app@localhost:5433/booktracker -c "DELETE FROM audit_log;"
```

`request_id` matches the `X-Request-Id` header in the curl transcript for the
same request, which ties each audit row to one HTTP call.

## My output (commit `_______`, date `_______`)

```
(paste here — the actor_subject values are synthetic test-user ids)
```

## My interpretation

_(In your own words.)_
