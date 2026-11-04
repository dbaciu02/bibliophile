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
| `periodEnd(2028-02-01, month)` | { date: "2028-02-29", precision: "month" } | “2028-02-29”  | partial yes - returned string instead of object |
| `isUpcoming(2026-11-01 month, today 2026-11-20)` | false | true | no | 
| `isUpcoming(2026-10-01 month, today 2026-11-20)` | false | false | yes |

Date predicted: 11/2/2026

Output:
```
 ✓ test/releaseDate.test.ts (25 tests) 10ms
   ✓ normalizePublishedDate (14)
     ✓ "2026" -> {"date":"2026-01-01","precision":"year"} 3ms
     ✓ "2026-11" -> {"date":"2026-11-01","precision":"month"} 0ms
     ✓ "2026-11-04" -> {"date":"2026-11-04","precision":"day"} 0ms
     ✓ "  2026-11-04 " -> {"date":"2026-11-04","precision":"day"} 0ms
     ✓ "2028-02-29" -> {"date":"2028-02-29","precision":"day"} 0ms
     ✓ rejects "" 0ms
     ✓ rejects "Nov 2026" 0ms
     ✓ rejects "2026-13" 0ms
     ✓ rejects "2026-00" 1ms
     ✓ rejects "2026-02-30" 0ms
     ✓ rejects "2027-02-29" 0ms
     ✓ rejects "0999" 0ms
     ✓ rejects "2026-1-4" 0ms
     ✓ rejects "2026-11-04T00:00:00Z" 0ms
   ✓ periodEnd (4)
     ✓ day precision ends the same day 0ms
     ✓ month precision ends on the last day of the month (30-day month) 0ms
     ✓ month precision handles leap-year February 0ms
     ✓ year precision ends on Dec 31 0ms
   ✓ isUpcoming (today = 2026-11-20) (6)
     ✓ {"date":"2026-11-04","precision":"day"} -> false 0ms
     ✓ {"date":"2026-11-20","precision":"day"} -> true 0ms
     ✓ {"date":"2026-11-01","precision":"month"} -> true 0ms
     ✓ {"date":"2026-10-01","precision":"month"} -> false 0ms
     ✓ {"date":"2026-01-01","precision":"year"} -> true 0ms
     ✓ {"date":"2025-01-01","precision":"year"} -> false 0ms
   ✓ compareReleaseDates (1)
     ✓ sorts earliest first, exact dates before vaguer ones on the same start date 0ms

 Test Files  1 passed (1)
      Tests  25 passed (25)
   Start at  12:29:33
   Duration  298ms (transform 53%, setup 16%, import 14%, tests 12%, worker 5%)
```

<!---If you and a test disagree, don't edit the test to match — figure out which
one is wrong and note it here. (That is a good candidate for the
*"challenged AI claim" in Q3.) -->
