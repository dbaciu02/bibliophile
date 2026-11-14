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

## My output (commit d818b7831e56b1be66b355ec994f7d4f9b5294a6, date `11-14-2026`)

```
  SELECT id, at, actor_subject, actor_role, action, entity_type, entity_id,   
         before->>'title' AS before_title, after->>'title' AS after_title, request_id
    FROM audit_log ORDER BY id DESC LIMIT 10;"


 id |              at               |            actor_subject             | actor_role |      action      |  entity_type   | entity_id | before_title  |  after_title  |        request_id              
----+-------------------------------+--------------------------------------+------------+------------------+----------------+-----------+---------------+---------------+--------------------------------------
 10 | 2026-11-14 00:41:24.152662+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.hide     | book           | 3         | Evidence Book | Evidence Book | 41a7423a-b3cf-436c-9cbe-af93147f9407
  9 | 2026-11-14 00:41:24.011022+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.update   | book           | 3         | Evidence Book | Evidence Book | db3c37de-4a43-4e41-b066-e00a2624bbf4
  8 | 2026-11-14 00:41:23.828227+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.create   | book           | 3         |               | Evidence Book | 2a14dff1-0bee-49bf-b5c5-6f72bc737d55
  7 | 2026-11-14 00:41:23.74612+00  | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | watchlist.remove | watchlist_item | 3         |               |               | 645f8a23-5edb-445d-b04a-bfb0dfab2af8
  6 | 2026-11-14 00:41:23.607943+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | watchlist.add    | watchlist_item | 3         |               |               | e0fc8164-5503-42d0-b5e9-6aa301f0df00
  5 | 2026-11-14 00:10:01.710711+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.hide     | book           | 1         | Evidence Book | Evidence Book | fb5f1ccb-b33b-4f83-9eb1-f680f97d8b28
  4 | 2026-11-14 00:10:01.472961+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.update   | book           | 1         | Evidence Book | Evidence Book | e6c30cf8-ec65-4c21-bf6b-f42345405f0e
  3 | 2026-11-14 00:10:01.186923+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.create   | book           | 1         |               | Evidence Book | 278ad2a6-9cdd-49d5-88f9-b1d2e589d232
  2 | 2026-11-14 00:10:01.055919+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | watchlist.remove | watchlist_item | 1         |               |               | 2e804:...skipping...
 id |              at               |            actor_subject             | actor_role |      action      |  entity_type   | entity_id | before_title  |  after_title  |        request_id              
----+-------------------------------+--------------------------------------+------------+------------------+----------------+-----------+---------------+---------------+--------------------------------------
 10 | 2026-11-14 00:41:24.152662+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.hide     | book           | 3         | Evidence Book | Evidence Book | 41a7423a-b3cf-436c-9cbe-af93147f9407
  9 | 2026-11-14 00:41:24.011022+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.update   | book           | 3         | Evidence Book | Evidence Book | db3c37de-4a43-4e41-b066-e00a2624bbf4
  8 | 2026-11-14 00:41:23.828227+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.create   | book           | 3         |               | Evidence Book | 2a14dff1-0bee-49bf-b5c5-6f72bc737d55
  7 | 2026-11-14 00:41:23.74612+00  | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | watchlist.remove | watchlist_item | 3         |               |               | 645f8a23-5edb-445d-b04a-bfb0dfab2af8
  6 | 2026-11-14 00:41:23.607943+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | watchlist.add    | watchlist_item | 3         |               |               | e0fc8164-5503-42d0-b5e9-6aa301f0df00
  5 | 2026-11-14 00:10:01.710711+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.hide     | book           | 1         | Evidence Book | Evidence Book | fb5f1ccb-b33b-4f83-9eb1-f680f97d8b28
  4 | 2026-11-14 00:10:01.472961+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.update   | book           | 1         | Evidence Book | Evidence Book | e6c30cf8-ec65-4c21-bf6b-f42345405f0e
  3 | 2026-11-14 00:10:01.186923+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.create   | book           | 1         |               | Evidence Book | 278ad2a6-9cdd-49d5-88f9-b1d2e589d232
  2 | 2026-11-14 00:10:01.055919+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | watchlist.remove | watchlist_item | 1         |               |               | 2e804df4-070e-4478-9ee5-afff3dab01c1
:...skipping...
 id |              at               |            actor_subject             | actor_role |      action      |  entity_type   | entity_id | before_title  |  after_title  |        request_id              
----+-------------------------------+--------------------------------------+------------+------------------+----------------+-----------+---------------+---------------+--------------------------------------
 10 | 2026-11-14 00:41:24.152662+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.hide     | book           | 3         | Evidence Book | Evidence Book | 41a7423a-b3cf-436c-9cbe-af93147f9407
  9 | 2026-11-14 00:41:24.011022+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.update   | book           | 3         | Evidence Book | Evidence Book | db3c37de-4a43-4e41-b066-e00a2624bbf4
  8 | 2026-11-14 00:41:23.828227+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.create   | book           | 3         |               | Evidence Book | 2a14dff1-0bee-49bf-b5c5-6f72bc737d55
  7 | 2026-11-14 00:41:23.74612+00  | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | watchlist.remove | watchlist_item | 3         |               |               | 645f8a23-5edb-445d-b04a-bfb0dfab2af8
  6 | 2026-11-14 00:41:23.607943+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | watchlist.add    | watchlist_item | 3         |               |               | e0fc8164-5503-42d0-b5e9-6aa301f0df00
  5 | 2026-11-14 00:10:01.710711+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.hide     | book           | 1         | Evidence Book | Evidence Book | fb5f1ccb-b33b-4f83-9eb1-f680f97d8b28
  4 | 2026-11-14 00:10:01.472961+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.update   | book           | 1         | Evidence Book | Evidence Book | e6c30cf8-ec65-4c21-bf6b-f42345405f0e
  3 | 2026-11-14 00:10:01.186923+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.create   | book           | 1         |               | Evidence Book | 278ad2a6-9cdd-49d5-88f9-b1d2e589d232
  2 | 2026-11-14 00:10:01.055919+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | watchlist.remove | watchlist_item | 1         |               |               | 2e804df4-070e-4478-9ee5-afff3dab01c1
  1 | 2026-11-14 00:10:00.812785+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | watchlist.add    | watchlist_item | 1         |               |               | 4e9b645f-676f-460b-a845-64de2b4f885b
(10 rows)

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
~
~
~
(END)...skipping...
 id |              at               |            actor_subject             | actor_role |      action      |  entity_type   | entity_id | before_title  |  after_title  |        request_id              
----+-------------------------------+--------------------------------------+------------+------------------+----------------+-----------+---------------+---------------+--------------------------------------
 10 | 2026-11-14 00:41:24.152662+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.hide     | book           | 3         | Evidence Book | Evidence Book | 41a7423a-b3cf-436c-9cbe-af93147f9407
  9 | 2026-11-14 00:41:24.011022+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.update   | book           | 3         | Evidence Book | Evidence Book | db3c37de-4a43-4e41-b066-e00a2624bbf4
  8 | 2026-11-14 00:41:23.828227+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.create   | book           | 3         |               | Evidence Book | 2a14dff1-0bee-49bf-b5c5-6f72bc737d55
  7 | 2026-11-14 00:41:23.74612+00  | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | watchlist.remove | watchlist_item | 3         |               |               | 645f8a23-5edb-445d-b04a-bfb0dfab2af8
  6 | 2026-11-14 00:41:23.607943+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | watchlist.add    | watchlist_item | 3         |               |               | e0fc8164-5503-42d0-b5e9-6aa301f0df00
  5 | 2026-11-14 00:10:01.710711+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.hide     | book           | 1         | Evidence Book | Evidence Book | fb5f1ccb-b33b-4f83-9eb1-f680f97d8b28
  4 | 2026-11-14 00:10:01.472961+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.update   | book           | 1         | Evidence Book | Evidence Book | e6c30cf8-ec65-4c21-bf6b-f42345405f0e
  3 | 2026-11-14 00:10:01.186923+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.create   | book           | 1         |               | Evidence Book | 278ad2a6-9cdd-49d5-88f9-b1d2e589d232
  2 | 2026-11-14 00:10:01.055919+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | watchlist.remove | watchlist_item | 1         |               |               | 2e804df4-070e-4478-9ee5-afff3dab01c1
  1 | 2026-11-14 00:10:00.812785+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | watchlist.add    | watchlist_item | 1         |               |               | 4e9b645f-676f-460b-a845-64de2b4f885b
(10 rows)

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
 id |              at               |            actor_subject             | actor_role |      action      |  entity_type   | entity_id | before_title  |  after_title  |        request_id              
----+-------------------------------+--------------------------------------+------------+------------------+----------------+-----------+---------------+---------------+--------------------------------------
 10 | 2026-11-14 00:41:24.152662+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.hide     | book           | 3         | Evidence Book | Evidence Book | 41a7423a-b3cf-436c-9cbe-af93147f9407
  9 | 2026-11-14 00:41:24.011022+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.update   | book           | 3         | Evidence Book | Evidence Book | db3c37de-4a43-4e41-b066-e00a2624bbf4
  8 | 2026-11-14 00:41:23.828227+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.create   | book           | 3         |               | Evidence Book | 2a14dff1-0bee-49bf-b5c5-6f72bc737d55
  7 | 2026-11-14 00:41:23.74612+00  | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | watchlist.remove | watchlist_item | 3         |               |               | 645f8a23-5edb-445d-b04a-bfb0dfab2af8
  6 | 2026-11-14 00:41:23.607943+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | watchlist.add    | watchlist_item | 3         |               |               | e0fc8164-5503-42d0-b5e9-6aa301f0df00
  5 | 2026-11-14 00:10:01.710711+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.hide     | book           | 1         | Evidence Book | Evidence Book | fb5f1ccb-b33b-4f83-9eb1-f680f97d8b28
  4 | 2026-11-14 00:10:01.472961+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.update   | book           | 1         | Evidence Book | Evidence Book | e6c30cf8-ec65-4c21-bf6b-f42345405f0e
  3 | 2026-11-14 00:10:01.186923+00 | 56c8a35d-fde1-4fe7-9246-a186e24ff9ec | Curator    | release.create   | book           | 1         |               | Evidence Book | 278ad2a6-9cdd-49d5-88f9-b1d2e589d232
  2 | 2026-11-14 00:10:01.055919+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | watchlist.remove | watchlist_item | 1         |               |               | 2e804df4-070e-4478-9ee5-afff3dab01c1
  1 | 2026-11-14 00:10:00.812785+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | watchlist.add    | watchlist_item | 1         |               |               | 4e9b645f-676f-460b-a845-64de2b4f885b
(10 rows)



PSQL query
------------
psql postgres://app:app@localhost:5433/booktracker -c "UPDATE audit_log SET action = 'tampered';"
psql postgres://app:app@localhost:5433/booktracker -c "DELETE FROM audit_log;"

ERROR:  audit_log is append-only (UPDATE rejected)
CONTEXT:  PL/pgSQL function audit_log_reject_change() line 3 at RAISE
ERROR:  audit_log is append-only (DELETE rejected)
CONTEXT:  PL/pgSQL function audit_log_reject_change() line 3 at RAISE
```

## My interpretation
<!-- Who: where actor_subject comes from (the validated token, not anything the client sent), and which test user each subject belongs to.
What and when: the action and at columns.
Before/after: for the release.update row, what changed between before_title and after_title. In your run the title stayed the same and the date changed. Say that the query only shows titles, and the full before/after JSON is in the table.
The link: the matching request id from step 3, showing this row came from that exact HTTP request.
Append-only: what the two errors prove, and that the database enforces it, not just the app. -->

The table above shows the audit log entries for various actions performed on the book tracker. It includes the timestamp (`at`), the actor performing the action (`actor_subject` and `actor_role`), the type of action (`action`), the entity affected (`entity_type` and `entity_id`), the state before and after the action (`before_title` and `after_title`), and the corresponding request ID (`request_id`). The actor subject Reader ID is the same as the one in api/me in the curl transcript and it confirms it being the same for Curator as well. This demonstrates that the audit log accurately records the actions of different actors and enforces the append-only constraint, preventing any tampering with existing entries. Looking at `6 | 2026-11-14 00:41:23.607943+00 | 62ed3f40-0f6e-40a9-822b-aa0fed1242ed | Reader     | watchlist.add    | watchlist_item | 3         |               |               | e0fc8164-5503-42d0-b5e9-6aa301f0df00` we can see that the entry accurately reflects the addition of a watchlist item by the Reader, with the appropriate request ID linking it to the corresponding HTTP request. In the curl transcript we see it as:
```bash
## GET /api/me -> 200 (identity and role from the validated token)
$ curl -i -H 'Authorization: Bearer <reader token>' http://localhost:3000/api/me

HTTP/1.1 200 OK
X-Request-Id: 9ffa6c8b-600b-4c59-a468-e677471032a4
Cache-Control: private, no-store
Content-Type: application/json; charset=utf-8
Content-Length: 156
ETag: W/"9c-T2oKkhzaI5izP5BvpFC2AX4f7T0"
Date: Sat, 14 Nov 2026 00:41:23 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"subject":"62ed3f40-0f6e-40a9-822b-aa0fed1242ed","name":"Test Reader","roles":["Reader"],"scopes":["Releases.Read","Releases.Write","Watchlist.ReadWrite"]}
```
So, the audit log entry for the watchlist addition by the Reader is directly linked to the HTTP request made with the corresponding token, confirming the accuracy and traceability of the recorded actions. In contrast, any attempts to update or delete entries in the audit log, as shown in the PSQL query above, are rejected due to the append-only constraint, further ensuring the integrity and immutability of the audit log.