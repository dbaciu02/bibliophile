#!/usr/bin/env node
// Small closed-loop load test for the scaling section of docs/cost.md.
//
//   node scripts/load-test.mjs <url> [<url> ...] [-c 10] [-d 30] [--json out.json]
//
// - GET only, no cookies, no tokens: it can only read the public catalog
//   and /healthz, so it can't change data or touch anyone's account.
// - `-c` virtual users each send one request, wait for the answer, send the
//   next, for `-d` seconds. Several URLs are used in turn (round-robin).
// - Refuses production hosts unless --allow-production: run it on staging.
// - One warm-up request first (Render's free tier sleeps; a cold start can
//   take ~60 s). It is reported separately and not counted.
// - Counts Netlify CDN hits from the Cache-Status header, so the same run
//   through the site (CDN) and straight to the API (origin) can be compared.
//
// Node 18+ (global fetch). No dependencies.

const args = process.argv.slice(2);
const opt = { c: 10, d: 30, json: undefined, allowProduction: false, timeoutMs: 10_000 };
const urls = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "-c" || a === "--concurrency") opt.c = Number(args[++i]);
  else if (a === "-d" || a === "--duration") opt.d = Number(args[++i]);
  else if (a === "--json") opt.json = args[++i];
  else if (a === "--timeout") opt.timeoutMs = Number(args[++i]) * 1000;
  else if (a === "--allow-production") opt.allowProduction = true;
  else if (a === "-h" || a === "--help") usage(0);
  else if (a.startsWith("-")) usage(1, `unknown option ${a}`);
  else urls.push(a);
}
if (urls.length === 0) usage(1, "give at least one URL");
if (!Number.isInteger(opt.c) || opt.c < 1 || opt.c > 50) usage(1, "-c must be 1..50 (this is a small test on free tiers)");
if (!Number.isFinite(opt.d) || opt.d < 1 || opt.d > 300) usage(1, "-d must be 1..300 seconds");

for (const u of urls) {
  const url = new URL(u); // throws on garbage
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (!local && url.protocol !== "https:") usage(1, `${u}: use https`);
  if (!local && !url.hostname.includes("staging") && !opt.allowProduction) {
    usage(1, `${url.hostname} doesn't look like staging. Run load on staging; add --allow-production only if you mean it.`);
  }
}

function usage(code, msg) {
  if (msg) console.error(`load-test: ${msg}\n`);
  console.error("usage: node scripts/load-test.mjs <url> [<url> ...] [-c 10] [-d 30] [--json out.json] [--timeout 10] [--allow-production]");
  process.exit(code);
}

/** Netlify: `Cache-Status: "Netlify Edge"; hit` (or `fwd=miss`, `fwd=stale`). */
function cacheResult(res) {
  const s = res.headers.get("cache-status");
  if (!s) return "none";
  if (/;\s*hit\b/i.test(s)) return "hit";
  if (/fwd=stale/i.test(s)) return "stale";
  if (/fwd=/i.test(s)) return "miss";
  return "other";
}

async function once(url) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "bibliophile-load-test" },
      signal: AbortSignal.timeout(opt.timeoutMs),
    });
    const body = await res.arrayBuffer();
    return { ms: performance.now() - t0, status: res.status, bytes: body.byteLength, cache: cacheResult(res) };
  } catch (err) {
    return { ms: performance.now() - t0, status: 0, bytes: 0, cache: "none", error: err?.name ?? "Error" };
  }
}

const pct = (sorted, p) => (sorted.length === 0 ? NaN : sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]);
const r = (n) => (Number.isFinite(n) ? Math.round(n) : "—");

// ---- warm-up (wakes a sleeping free instance; up to 90 s)
const warmStart = performance.now();
let warm = await once(urls[0]);
while (warm.status === 0 && performance.now() - warmStart < 90_000) {
  await new Promise((res) => setTimeout(res, 2000));
  warm = await once(urls[0]);
}
console.error(`warm-up: ${warm.status || warm.error} in ${r(performance.now() - warmStart)} ms`);
if (warm.status === 0) {
  console.error("load-test: target never answered; stopping.");
  process.exit(2);
}

// ---- the run
const results = [];
let next = 0;
const stopAt = performance.now() + opt.d * 1000;
const startedAt = new Date();
const t0 = performance.now();
async function user() {
  while (performance.now() < stopAt) {
    const url = urls[next++ % urls.length];
    results.push({ url, ...(await once(url)) });
  }
}
await Promise.all(Array.from({ length: opt.c }, user));
const seconds = (performance.now() - t0) / 1000;

// ---- summary
const ok = results.filter((x) => x.status >= 200 && x.status < 400);
const lat = ok.map((x) => x.ms).sort((a, b) => a - b);
const byStatus = {};
for (const x of results) {
  const k = x.status === 0 ? `error:${x.error}` : String(x.status);
  byStatus[k] = (byStatus[k] ?? 0) + 1;
}
const cache = { hit: 0, miss: 0, stale: 0, other: 0, none: 0 };
for (const x of results) cache[x.cache] += 1;
const cdnSeen = results.length - cache.none;
const summary = {
  startedAt: startedAt.toISOString(),
  urls,
  concurrency: opt.c,
  durationSeconds: Math.round(seconds * 10) / 10,
  requests: results.length,
  requestsPerSecond: Math.round((results.length / seconds) * 10) / 10,
  errorRatePercent: Math.round(((results.length - ok.length) / Math.max(1, results.length)) * 1000) / 10,
  latencyMs: { p50: r(pct(lat, 50)), p95: r(pct(lat, 95)), p99: r(pct(lat, 99)), max: r(lat.at(-1)) },
  statuses: byStatus,
  cdn: cdnSeen === 0 ? "no Cache-Status header (not through the CDN)" : { ...cache, hitPercent: Math.round((cache.hit / cdnSeen) * 1000) / 10 },
  kilobytesReceived: Math.round(results.reduce((s, x) => s + x.bytes, 0) / 1024),
};

const where = urls.length === 1 ? urls[0] : `${urls.length} URLs`;
console.log(`\n${where}`);
console.log(`${summary.requests} requests in ${summary.durationSeconds} s with ${opt.c} users = ${summary.requestsPerSecond} req/s`);
console.log(`latency (successful): p50 ${summary.latencyMs.p50} ms, p95 ${summary.latencyMs.p95} ms, p99 ${summary.latencyMs.p99} ms, max ${summary.latencyMs.max} ms`);
console.log(`statuses: ${Object.entries(byStatus).map(([k, v]) => `${k}×${v}`).join(", ")}   errors: ${summary.errorRatePercent}%`);
console.log(typeof summary.cdn === "string" ? `cdn: ${summary.cdn}` : `cdn: ${summary.cdn.hitPercent}% hit (hit ${cache.hit}, miss ${cache.miss}, stale ${cache.stale})`);
console.log("\nmarkdown row (| target | users | req/s | p50 | p95 | p99 | errors | CDN hit |):");
console.log(
  `| ${where} | ${opt.c} | ${summary.requestsPerSecond} | ${summary.latencyMs.p50} | ${summary.latencyMs.p95} | ${summary.latencyMs.p99} | ${summary.errorRatePercent}% | ${typeof summary.cdn === "string" ? "—" : `${summary.cdn.hitPercent}%`} |`,
);

if (opt.json) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(opt.json, `${JSON.stringify(summary, null, 2)}\n`);
  console.error(`\nwrote ${opt.json}`);
}
