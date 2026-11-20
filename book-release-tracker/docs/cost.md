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
responses. Production deploys: **~10 a month** (the pipeline only redeploys
the site when `web/` changed).

## Arithmetic per provider

**Netlify (website + CDN).** Credits: 20 per GB, 2 per 10,000 requests, 15
per production deploy. **This project is on a paid plan at $7 a month**
(upgraded during setup: the free plan allows only 3 custom-domain changes
per hour and 300 credits a month). The figures below assume it includes
1,000 credits a month; check Netlify → Billing for the exact allowance.

| | 1× | 10× | 100× |
| --- | --- | --- | --- |
| Bandwidth | 2,700 × 0.15 MB = 0.4 GB → **8** | 4.05 GB → **81** | 40.5 GB → **810** |
| Requests | 10,800 → **2** | 108,000 → **22** | 1,080,000 → **216** |
| Deploys | 10 × 15 = **150** | **150** | **150** |
| Credits / month | **160** | **253** | **1,176** |
| Cost | **$7** (plan) | **$7** | $7 + one 500-credit pack $5 = **$12** |

**Render (API + Postgres).** Free web services sleep after 15 minutes idle
and share 750 instance hours a month per workspace. An always-on Starter
instance is $7. The free database expires after 30 days, and Basic-256mb is $6.

| | 1× | 10× | 100× |
| --- | --- | --- | --- |
| API, production | Free (awake ~8 h/day ≈ 240 h) | **Starter $7**: awake ~20 h/day would use most of the 750 h, and sleeping breaks the latency SLO | **Starter $7**: ~1.1 M requests ≈ 0.4 req/s average, ~4 req/s at peak, well inside 0.5 CPU |
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
