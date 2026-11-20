# Redaction attestation (Q3, hard gates 1 and 2)

I checked every evidence file, screenshot, recording and transcript in this
repository and in the submission before handing it in.

| Check | How I checked | Done |
| --- | --- | --- |
| No access tokens, ID tokens or refresh tokens (`eyJ…`) | `git grep -nE "eyJ[A-Za-z0-9_-]{20,}"` returns nothing; screenshots reviewed by eye | ☐ |
| No Google API key (`AIza…`) | `git grep -n "AIza"` returns nothing | ☐ |
| No database URLs with passwords | `git grep -nE "postgres(ql)?://[^:@/]+:[^@/]+@" -- ':!*.example' ':!docker-compose.yml' ':!api/test'` only shows the local dev `app:app` values and `user:pass` placeholders in comments | ☐ |
| No deploy hooks, Netlify/GitHub/Grafana tokens | `git grep -nE "api.render.com/deploy|nfp_|ghp_|glc_|Basic [A-Za-z0-9+/=]{20,}"` returns nothing | ☐ |
| HAR files only in redacted form; the raw HAR deleted | `scripts/redact-har.mjs` output only | ☐ |
| Screenshots: no token in DevTools panes, no secrets in env-var pages, no personal email/phone | reviewed each image | ☐ |
| All data is synthetic (seeded books, test users) | the seed script + Test Reader / Test Curator accounts | ☐ |
| Evidence is my own output, unaltered (except redactions, marked as such) | — | ☐ |

Secrets for grading are delivered separately and privately, and are rotated
after grading ([secrets.md](../secrets.md)).

Name: __________________ Date: __________ Commit: `________`
