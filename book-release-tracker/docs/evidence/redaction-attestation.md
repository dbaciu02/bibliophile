# Redaction attestation (Q3, hard gates 1 and 2)

I checked every evidence file, screenshot, recording and transcript in this
repository and in the submission before handing it in.

| Check | How I checked | Done |
| --- | --- | --- |
| No access tokens, ID tokens or refresh tokens (`eyJ…`) | `git grep -nE "eyJ[A-Za-z0-9_-]{20,}"` returns nothing; screenshots reviewed by eye | Done |
| No Google API key (`AIza…`) | `git grep -n "AIza"` returns nothing | done |
| No database URLs with passwords | `git grep -nE "postgres(ql)?://[^:@/]+:[^@/]+@" -- ':!*.example' ':!docker-compose.yml' ':!api/test'` only shows the local dev `app:app` values and `user:pass` placeholders in comments | Done |
| No deploy hooks, Netlify/GitHub/Grafana tokens | `git grep -nE "api.render.com/deploy|nfp_|ghp_|glc_|Basic [A-Za-z0-9+/=]{20,}"` returns nothing | Done |
| HAR files only in redacted form; the raw HAR deleted | `scripts/redact-har.mjs` output only | Done |
| Screenshots: no token in DevTools panes, no secrets in env-var pages, no personal email/phone | reviewed each image | Done |
| All data is synthetic (seeded books, test users) | the seed script + Test Reader / Test Curator accounts | Done |
| Evidence is my own output, unaltered (except redactions, marked as such) | — | Done |

Secrets for grading are delivered on D2L, and are rotated
after grading ([secrets.md](../secrets.md)). The md file contains information about the rotation and handling of secrets for grading purposes.

Name: Dora Baciu Date: 2026-11-24 Commit: `0f34b5e4e65c34dc08ee6c2c46827b486552d4f1`
