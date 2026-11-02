# Q1 hand predictions — release date normalization

**Fill this in yourself, by hand, before running `npm test`.** The test file
already contains expected values (written with AI help, logged in
`docs/ai-use-log.md`), so cover the right-hand column of the test file or work
from this sheet only. Then run the tests and record whether you agreed.

Rules being tested (`api/src/lib/releaseDate.ts`):
- `"YYYY"` → first day of the year, precision `year`
- `"YYYY-MM"` → first day of the month, precision `month`
- `"YYYY-MM-DD"` → that day, precision `day`; must be a real calendar date
- A release is *upcoming* until the last day of its period has passed

| Input | My prediction (written before running) | Test result | Agreed? |
| --- | --- | --- | --- |
| `normalize("2026-11")` | { date: "2026-11-01", precision: "month" } | {"date":"2026-11-01","precision":"month"} | yes  |
| `normalize("2026-02-30")` | { date: "2026-02-30", precision: "day" } |rejects "2026-02-30"| no |
| `normalize("2028-02-29")` | { date: "2028-02-29", precision: "day" } | {"date":"2028-02-29","precision":"day"} | yes |
| `normalize("2027-02-29")` | { date: "2027-02-29", precision: "day" } | rejects "2027-02-29" | no |
| `periodEnd(2028-02-01, month)` | { date: "2028-02-29", precision: "month" } |   |  |
| `isUpcoming(2026-11-01 month, today 2026-11-20)` | true | true | yes | 
| `isUpcoming(2026-10-01 month, today 2026-11-20)` | false | false | yes |

Date predicted: 10/28/2026

If you and a test disagree, don't edit the test to match — figure out which
one is wrong and note it here. (That is a good candidate for the
"challenged AI claim" in Q3.)
