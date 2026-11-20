#!/usr/bin/env node
// Summarise Lighthouse JSON reports into a before/after table (D8).
//   node scripts/lh-summary.mjs docs/evidence/lighthouse/before-*.json -- docs/evidence/lighthouse/after-*.json
// Uses the MEDIAN of the runs in each group (Lighthouse varies run to run).
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const split = args.indexOf("--");
const groups = split === -1 ? [["runs", args]] : [["before", args.slice(0, split)], ["after", args.slice(split + 1)]];
if (groups.some(([, files]) => files.length === 0)) {
  console.error("usage: node scripts/lh-summary.mjs before-*.json -- after-*.json");
  process.exit(1);
}

const METRICS = [
  ["Performance score", (r) => r.categories.performance.score * 100, ""],
  ["LCP (Largest Contentful Paint)", (r) => r.audits["largest-contentful-paint"].numericValue, "ms"],
  ["CLS (Cumulative Layout Shift)", (r) => r.audits["cumulative-layout-shift"].numericValue, ""],
  ["TBT (Total Blocking Time, lab proxy for INP)", (r) => r.audits["total-blocking-time"].numericValue, "ms"],
  ["FCP (First Contentful Paint)", (r) => r.audits["first-contentful-paint"].numericValue, "ms"],
  ["JavaScript transferred", (r) => (r.audits["resource-summary"]?.details?.items ?? []).find((i) => i.resourceType === "script")?.transferSize / 1024, "kB"],
  ["Total transferred", (r) => r.audits["total-byte-weight"].numericValue / 1024, "kB"],
];
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (v, unit) => (unit === "" ? (v < 1 ? v.toFixed(3) : v.toFixed(0)) : `${v.toFixed(0)} ${unit}`);

const results = groups.map(([name, files]) => {
  const reports = files.map((f) => JSON.parse(readFileSync(f, "utf8")));
  const urls = [...new Set(reports.map((r) => r.finalDisplayedUrl ?? r.finalUrl))];
  const when = reports.map((r) => r.fetchTime).sort();
  console.log(`${name}: ${files.length} run(s) of ${urls.join(", ")}, ${when[0]} … ${when.at(-1)}, form factor ${reports[0].configSettings.formFactor}`);
  return METRICS.map(([, get]) => median(reports.map(get).filter((v) => Number.isFinite(v))));
});

console.log();
console.log(`| Metric (median) | ${groups.map(([n]) => n).join(" | ")}${groups.length === 2 ? " | change |" : " |"}`);
console.log(`| --- | ${groups.map(() => "---").join(" | ")}${groups.length === 2 ? " | --- |" : " |"}`);
METRICS.forEach(([label, , unit], i) => {
  const vals = results.map((r) => r[i]);
  const change = groups.length === 2 && vals[0] ? ` | ${(((vals[1] - vals[0]) / vals[0]) * 100).toFixed(0)}% |` : groups.length === 2 ? " | — |" : " |";
  console.log(`| ${label} | ${vals.map((v) => fmt(v, unit)).join(" | ")}${change}`);
});
