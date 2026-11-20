# D8 — Core Web Vitals: measured, one improvement with before/after

**Order matters:** measure the **baseline first**, on the deployed site,
*before* applying the improvement (`d8-improvement` zip). Then deploy the
improvement and measure again under the same conditions.

## How to measure (same way both times)

1. Wake the API first so a cold start doesn't pollute the numbers:
   `curl -s https://api.bibliophile.<domain>/healthz` until it answers in
   under a second.
2. Run Lighthouse **3 times** against the production home page (the releases
   list: its LCP element) and keep the JSON reports:

   ```bash
   mkdir -p docs/evidence/lighthouse
   for i in 1 2 3; do
     npx lighthouse https://bibliophile.<domain>/ --only-categories=performance \
       --output=json --output-path=docs/evidence/lighthouse/before-$i.json \
       --chrome-flags="--headless=new" --quiet
   done
   ```

   (Uses your installed Chrome; defaults to a mid-range phone on a throttled
   connection, which is what we compare.) No CLI? Chrome → DevTools →
   **Lighthouse** → Mobile → Performance → Analyze, three times, and save
   each report as JSON (⋮ → Save as JSON) under the same names.
3. After deploying the improvement, the same with `after-$i.json`.
4. Summary table:

   ```bash
   node scripts/lh-summary.mjs docs/evidence/lighthouse/before-*.json -- docs/evidence/lighthouse/after-*.json
   ```

## Baseline (before) — commit `_______`, date `_______`

*(paste the "before" part of the summary, or the table once both exist)*

```
```

What is the LCP element? (Lighthouse → "Largest Contentful Paint element").
What does Lighthouse say costs the most time? _____

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

Your hypothesis — which metric should move, and why: _____

## After — commit `_______`, date `_______`

```
```

## Interpretation

_(In your own words: did LCP / TBT / transferred bytes move as predicted? Is
the difference bigger than the run-to-run spread? What would you try next?
Note anything that limits the comparison, e.g. network variance or the
free API's cold start.)_
