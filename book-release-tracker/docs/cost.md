# Cost (D11): monthly cost at 1×, 10× and 100×

Prices checked **2026-11-18** from each provider's pricing page (links at the
end). They change often. Recheck before relying on them.

## Usage model

| | 1× (course + a few friends) | 10× | 100× |
| --- | --- | --- | --- |
| Daily active users | 30 | 300 | 3,000 |
| Visits per month (3 per user per day × 30 days) | 2,700 | 27,000 | 270,000 |
| API requests per month (4 per visit: releases, me, watchlist, events) | 10,800 | 108,000 | 1,080,000 |
| Google Books calls per day (curators only; searches cached 6 h, books 24 h) | ~20 | ~100 | ~500 |

Per visit, worst case (nothing cached in the browser): about **150 kB** from
Netlify (HTML 0.3 kB + JS 118 kB + CSS 2 kB gzipped, rounded up for
headers and the favicon), about **4 site requests**, and about **20 kB** of API
responses. Two of the API calls per visit (the catalog list, and its re-check
when live updates connect) now go **through Netlify's CDN** (D6), about 5 kB
each before compression, so they count as Netlify requests and bandwidth too. Production deploys: **~10 a month** (the pipeline only redeploys
the site when `web/` changed).

## Arithmetic per provider

**Netlify (website + CDN).** Credits: 20 per GB, 2 per 10,000 requests, 15
per production deploy. **This project is on a paid plan at $7 a month**
(upgraded during setup: the free plan allows only 3 custom-domain changes
per hour and 300 credits a month). The figures below assume it includes
1,000 credits a month; check Netlify → Billing for the exact allowance.

| | 1× | 10× | 100× |
| --- | --- | --- | --- |
| Bandwidth, site | 2,700 × 0.15 MB = 0.4 GB → **8** | 4.05 GB → **81** | 40.5 GB → **810** |
| Bandwidth, catalog through the CDN (2 × 5 kB per visit) | 0.03 GB → **1** | 0.27 GB → **5** | 2.7 GB → **54** |
| Requests, site | 10,800 → **2** | 108,000 → **22** | 1,080,000 → **216** |
| Requests, catalog (2 per visit) | 5,400 → **1** | 54,000 → **11** | 540,000 → **108** |
| Deploys | 10 × 15 = **150** | **150** | **150** |
| Credits / month | **162** | **269** | **1,338** |
| Cost | **$7** (plan) | **$7** | $7 + one 500-credit pack $5 = **$12** (338 over) |

**Render (API + Postgres).** Free web services sleep after 15 minutes idle
and share 750 instance hours a month per workspace. An always-on Starter
instance is $7. The free database expires after 30 days, and Basic-256mb is $6.

| | 1× | 10× | 100× |
| --- | --- | --- | --- |
| API, production | Free (awake ~8 h/day ≈ 240 h) | **Starter $7**: awake ~20 h/day would use most of the 750 h, and sleeping breaks the latency SLO | **Starter $7**: ~1.1 M requests ≈ 0.4 req/s average, ~4 req/s at peak, well inside 0.5 CPU. Catalog reads are mostly answered by the CDN (see the load test below), so the API sees fewer than that |
| API, staging | Free (~60 h) | Free | Free |
| Postgres (both environments, one instance) | **$6** after day 30 ($0 before) | **$6** | **$6** (data stays under 1 GB; Basic-1gb $19 only if memory gets tight) |
| Cost | **$6** | **$13** | **$13** |

**Google Books.** Free, with a default quota of 1,000 queries a day. Even 100×
(~500 a day) fits. Rate limits (30 searches per minute per curator) and
caching keep it there. **$0** at every scale. Past the quota, Google refuses
the calls rather than billing for them.

**Grafana Cloud (observability).** Free: 10,000 metric series, 50 GB logs, 50
GB traces a month, 14-day retention.

| | 1× | 10× | 100× |
| --- | --- | --- | --- |
| Metric series (fixed by labels, not traffic) | ~2,500 | ~2,500 | ~2,500 |
| Logs (1 line ≈ 1 kB per request) | 0.01 GB | 0.1 GB | 1.1 GB |
| Traces (~10 spans ≈ 5 kB per request) | 0.05 GB | 0.5 GB | 5.4 GB |
| Cost | $0 | $0 | $0 |

**GitHub (code, CI, image registry).** About 8 Actions minutes per deploy
run. Private repositories get 2,000 free minutes a month (public: unlimited)
and 500 MB of free package storage. Images share their base layers. Keep the
last ~10 image versions (runbook), and it stays under 500 MB. **$0.** The
free plan's spending limit is $0, so going over stops things rather than
charging.

**Domain.** Already owned (Porkbun). Only the yearly renewal, shared with the
existing site. Not counted.

## Totals

| | 1× | 10× | 100× |
| --- | --- | --- | --- |
| During the course (first 30 days) | **$7** (Netlify) | — | — |
| Steady state, per month | **$13** | **$20** | **$25** |
| Biggest line | Netlify plan, then Postgres after the free 30 days | Always-on API + Netlify | Netlify (bandwidth credits) |
| What breaks first if not paid | the database is deleted (day 30 + 14) | latency SLO (cold starts) | the website stops when credits run out |

Arithmetic: 1× = Netlify $7 + Postgres $6 = $13; 10× = $7 + $6 + Starter API
$7 = $20; 100× = ($7 + $5) + $6 + $7 = $25. Cost grows roughly with
**bandwidth**, not requests or users: at 100×, 70% of Netlify credits are
bandwidth. The cheapest lever is shrinking the bundle
(the D8 improvement). Next is longer browser caching of the hashed assets
(already immutable for a year, so returning visitors cost almost nothing;
the "worst case" above assumes every visit is a first visit).

## Load test and scaling (measured on staging)

`scripts/load-test.mjs` is a small closed-loop load generator: N virtual
users, each sending one GET, waiting for the answer, then sending the next,
for D seconds. GET only and no tokens, so it can't change data or reach an
account. It refuses production hosts unless given `--allow-production`, and
it counts Netlify CDN hits from the `Cache-Status` header.

Run it from your own machine (Node 22+), against **staging**:

```bash
SWEB=https://staging.bibliophile.dorabaciu.dev
SAPI=https://api.staging.bibliophile.dorabaciu.dev
mkdir -p docs/evidence/load
# A: catalog through the CDN (what browsers do now)
node scripts/load-test.mjs "$SWEB/api/releases?limit=20" -c 10 -d 30 --json docs/evidence/load/a-cdn.json
# B: the same reads straight to the API (no CDN): what the origin can do alone
node scripts/load-test.mjs "$SAPI/api/releases?limit=20" -c 10 -d 30 --json docs/evidence/load/b-origin.json
# C: step up the origin until it bends (free instance: 0.1 CPU, 512 MB)
for c in 1 5 10 20; do node scripts/load-test.mjs "$SAPI/api/releases?limit=20" -c $c -d 20 --json docs/evidence/load/c-origin-$c.json; done
```

Each run prints a markdown row. Keep Grafana's dashboard
open during run C and screenshot the latency panel (p95 by route) and the
Render metrics (CPU, memory) for the same minutes.

Cost of running it: run A is at most ~10,000 requests (a CDN hit takes a
few ms, so 10 users go fast) at ~5 kB through Netlify ≈ 2 credits for
requests + 1 for bandwidth = **~3 credits**. Runs B and C don't touch Netlify. Render's free instance has
no per-request charge.

Results go in [evidence/load-test.md](evidence/load-test.md) (table plus
screenshots); the conclusions go here:

**Conclusions** *(write from your own numbers, two or three sentences each)*:

1. **Origin capacity.** The highest C row whose p95 is still under the
   latency SLO's 500 ms (observability.md) is what one free instance sustains. Compare it
   with the 100× peak above (~4 req/s).
2. **What the CDN buys.** Compare A with B: req/s, p95, and the hit rate.
   With a 60 s TTL, the API sees at most about one catalog request per
   distinct query per minute per CDN node, however many people read it.
3. **What breaks first, and the fix.** Usually CPU on the 0.1-CPU free
   instance (latency climbs before errors appear), then the database's
   connection limit. The fixes in order of cost: the CDN (done), the
   Starter instance ($7, 0.5 CPU, no sleeping), then a second instance
   (live events already fan out through Postgres LISTEN/NOTIFY, so every
   instance sees every change; the rate-limit windows are per instance and
   would move to a shared store at that point).

## Budget and free-tier guards (the D11 evidence)

Only Netlify is paid ($7/month, a fixed plan price); nothing here can surprise-bill:

| Provider | Guard | Screenshot for the evidence |
| --- | --- | --- |
| Netlify | Paid plan ($7/month) with a fixed credit allowance; usage emails as it fills up | Team → Billing → Usage (credits used this cycle) and the plan |
| Render | Hobby workspace, free instances; no paid service without choosing one | Workspace → Billing (current month $0) |
| GitHub | Spending limit $0 for Actions and Packages | Settings → Billing and plans → Spending limits |
| Grafana Cloud | Free plan, no card on file | Administration → Usage / Billing |
| Google Cloud | Books API quota (1,000 a day) | APIs & Services → Books API → Quotas |

**A real budget alert:** if your Google Cloud project has a billing account,
add **Billing → Budgets & alerts → Create budget**: amount **$1**, alerts at
50% / 90% / 100%, email to you. That's the "budget alert" screenshot. With
no billing account on the project, nothing can be charged, and the quota
screenshot is the guard.

## Sources

- [Render pricing](https://render.com/pricing) and [Render free tier](https://render.com/docs/free)
- [Netlify pricing](https://www.netlify.com/pricing/) and [Netlify credit-based plans](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/)
- [Grafana Cloud pricing](https://grafana.com/pricing/)
- Google Books API: quota shown in Google Cloud Console → APIs & Services → Books API → Quotas
- [GitHub Actions billing](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions) and [GitHub Packages billing](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-packages/about-billing-for-github-packages)
