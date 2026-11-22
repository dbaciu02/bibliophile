# D8 — Core Web Vitals: measured, one improvement with before/after

**Order matters:** measure the **baseline first**, on the deployed site,
*before* applying the improvement . Then deploy the
improvement and measure again under the same conditions.

## How to measure (same way both times)

1. Wake the API first so a cold start doesn't pollute the numbers:
   `curl -s https://api.bibliophile.dorabaciu.dev/healthz` until it answers in
   under a second.
2. Run Lighthouse **3 times** against the production home page (the releases
   list: its LCP element) and keep the JSON reports:

   ```bash
   mkdir -p docs/evidence/lighthouse
   for i in 1 2 3; do
     npx lighthouse https://bibliophile.dorabaciu.dev/ --only-categories=performance \
       --output=json --output-path=docs/evidence/lighthouse/before-$i.json \
       --chrome-flags="--headless=new" --quiet
   done
   ```

   Chrome → DevTools → **Lighthouse** → Mobile → Performance → Analyze, three times, and save
   each report as JSON (⋮ → Save as JSON) under the same names.

3. After deploying the improvement, the same with `after-$i.json`.
4. Summary table:

   ```bash
   node scripts/lh-summary.mjs docs/evidence/lighthouse/before-*.json -- docs/evidence/lighthouse/after-*.json
   ```

## Baseline (before) — date `11-21-2026`

*(paste the "before" part of the summary, or the table once both exist)*

```
runs: 3 run(s) of https://bibliophile.dorabaciu.dev/, 2026-11-22T03:28:05.455Z … 2026-11-22T03:28:33.719Z, form factor mobile

| Metric (median) | runs |
| --- | --- |
| Performance score | 92 |
| LCP (Largest Contentful Paint) | 980 ms |
| CLS (Cumulative Layout Shift) | 0.000 |
| TBT (Total Blocking Time, lab proxy for INP) | 28 ms |
| FCP (First Contentful Paint) | 980 ms |
| JavaScript transferred | 122 kB |
| Total transferred | 128 kB |
```

What is the LCP element? (Lighthouse → "Largest Contentful Paint element").
What does Lighthouse say costs the most time? The h1 element containing the page title.

## The improvement

What changed (the `d8-improvement` zip; read its commit message/diff):

1. **Smaller validation library in the browser:** the website's response
   checks use `zod/mini` (same rules, tree-shakable) instead of full `zod`.
2. **Pages load on demand:** the Watchlist and Curate pages are split into
   their own files and only downloaded when opened; the home page no longer
   ships their code.
3. **Earlier connection to the API:** `<link rel="preconnect">` to the API
   origin in the HTML, so DNS + TLS to the API overlap with downloading the
   JavaScript instead of starting after it.

Your hypothesis predicted before — which metric should move, and why: LCP should decrease because 
the improvements should reduce the amount of time it takes for LCP to render as well as improve overall page load performance.

## After — date `11-21-2026`

```
before: 3 run(s) of https://bibliophile.dorabaciu.dev/, 2026-11-22T03:29:20.381Z … 2026-11-22T03:29:47.652Z, form factor mobile
after: 3 run(s) of https://bibliophile.dorabaciu.dev/, 2026-11-22T03:57:25.770Z … 2026-11-22T03:57:52.063Z, form factor mobile

| Metric (median) | before | after | change |
| --- | --- | --- | --- |
| Performance score | 100 | 99 | -1% |
| LCP (Largest Contentful Paint) | 909 ms | 913 ms | 0% |
| CLS (Cumulative Layout Shift) | 0.013 | 0.013 | 0% |
| TBT (Total Blocking Time, lab proxy for INP) | 7 ms | 4 ms | -38% |
| FCP (First Contentful Paint) | 909 ms | 913 ms | 0% |
| JavaScript transferred | 122 kB | 105 kB | -14% |
| Total transferred | 128 kB | 110 kB | -14% |
```

## Interpretation
The LCP did move slightly, increasing from 909 ms to 913 ms, which varies run-to-run and is within the expected noise. The TBT decreased significantly, indicating improved responsiveness, and the transferred bytes decreased as expected due to the smaller JavaScript payload. Overall, the improvements had the intended effect on reducing blocking time and optimizing resource transfer, even if the LCP did not show a substantial change. I would try further optimizations to reduce LCP, such as optimizing the rendering of the h1 element or further reducing JavaScript payloads.
