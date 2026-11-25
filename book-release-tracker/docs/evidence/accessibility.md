# D9 — Accessibility: no serious/critical axe violations; keyboard only

Step 5 already ran axe on every page in the test browser (0 violations).
This is the same check on the **deployed** production site, plus a
keyboard-only walkthrough done by you.

## axe on the live site — date `11-22-2026`

Install the free **axe DevTools** extension in Chrome (Deque). Open each page,
DevTools → **axe DevTools** → *Scan all of my page*. Do it signed out and
signed in (Test Curator, so Curate is reachable):

| Page / state | Critical | Serious | Moderate | Minor | Screenshot |
| --- | --- | --- | --- | --- | --- |
| `/` signed out | |1 | | | docs/evidence/screenshots/D9-axe-signed-out.png |
| `/` signed in, Include past releases ticked | |1 | | | docs/evidence/screenshots/D9-axe-signed-in.png |
| `/watchlist` signed in | |1 | | |docs/evidence/screenshots/D9-axe-watchlist.png |
| `/curate` with search results | |1 | | |docs/evidence/screenshots/D9-axe-curate.png |
| An error state (e.g. `/curate` "year alone" message) | |1 | | |docs/evidence/screenshots/D9-axe-error.png |

## Keyboard-only walkthrough

Unplug/ignore the mouse. Use Tab / Shift+Tab / Enter / Space / arrow keys.
For each step note **pass/fail** and what you saw.

| # | Task | Pass? | Notes (focus visible? order sensible? anything unreachable?) |
| --- | --- | --- | --- |
| 1 | First Tab shows a **Skip to content** link; Enter jumps to the main content |Yes |Box outlines skip to content and visible skip to main content |
| 2 | Reach the nav; the current page is announced/marked |Yes |current page is /#main |
| 3 | Fill the releases filters, submit with Enter; results update |Yes|filter with keyword "the" and category "horror" - results appeared |
| 4 | Tick **Include past releases** with Space |Yes|past releases from 2026 appeared |
| 5 | Page with **Later →** / **← Earlier** |Yes | goes through and shows later and earlier book separated by month|
| 6 | Sign in and come back (Microsoft's page is theirs; just complete it) |Yes |can sign into curator which I used for this |
| 7 | Watchlist: type an author, **Follow**, then **Remove** one |Yes|can remove author easily |
| 8 | Curate: search, open **More fields**, search by ISBN |Yes | in this case I can add ISBN and get results |
| 9 | Open the **Live update log** and close it |Yes |can open and close the log  |
| 10 | Sign out |Yes | can sign out  |
| 11 | At no point was focus lost/invisible or trapped |Yes |buttons and search bars and check boxes highlighted |

## Interpretation

For the axe checks, the only serious issues was the heading structure that wasn't corresponding with some color contrast requirements. The keyboard walkthrough confirmed that all interactive elements are reachable and operable without a mouse, and focus is always visible and in a sensible order.
