# D9 — Accessibility: no serious/critical axe violations; keyboard only

Step 5 already ran axe on every page in the test browser (0 violations).
This is the same check on the **deployed** production site, plus a
keyboard-only walkthrough done by you.

## axe on the live site — commit `_______`, date `_______`

Install the free **axe DevTools** extension in Chrome (Deque). Open each page,
DevTools → **axe DevTools** → *Scan all of my page*. Do it signed out and
signed in (Test Curator, so Curate is reachable):

| Page / state | Critical | Serious | Moderate | Minor | Screenshot |
| --- | --- | --- | --- | --- | --- |
| `/` signed out | | | | | |
| `/` signed in, Include past releases ticked | | | | | |
| `/watchlist` signed in | | | | | |
| `/curate` with search results | | | | | |
| An error state (e.g. `/curate` "year alone" message) | | | | | |

Alternative: Lighthouse → *Accessibility* category (it runs axe rules) for
each page; record the score and any failed audits.

## Keyboard-only walkthrough

Unplug/ignore the mouse. Use Tab / Shift+Tab / Enter / Space / arrow keys.
For each step note **pass/fail** and what you saw (a short screen recording
is ideal).

| # | Task | Pass? | Notes (focus visible? order sensible? anything unreachable?) |
| --- | --- | --- | --- |
| 1 | First Tab shows a **Skip to content** link; Enter jumps to the main content | | |
| 2 | Reach the nav; the current page is announced/marked | | |
| 3 | Fill the releases filters, submit with Enter; results update | | |
| 4 | Tick **Include past releases** with Space | | |
| 5 | Page with **Later →** / **← Earlier** | | |
| 6 | Sign in and come back (Microsoft's page is theirs; just complete it) | | |
| 7 | Watchlist: type an author, **Follow**, then **Remove** one | | |
| 8 | Curate: search, open **More fields**, import a result | | |
| 9 | Open the **Live update log** and close it | | |
| 10 | Sign out | | |
| 11 | At no point was focus lost/invisible or trapped | | |

## Interpretation

_(What passed, what didn't, and what you'd fix. Automated tools catch only
part of accessibility — what does the keyboard walkthrough add?)_
