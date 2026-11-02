import { describe, expect, it } from "vitest";
import {
  compareReleaseDates,
  isUpcoming,
  normalizePublishedDate,
  periodEnd,
  type ReleaseDate,
} from "../src/lib/releaseDate.js";

// Q1 core calculation. Q1 requires the expected values to be hand-predicted
// before the test runs: record your own predictions in
// docs/evidence/hand-predictions.md, then compare with the test results.

describe("normalizePublishedDate", () => {
  it.each([
    ["2026", { date: "2026-01-01", precision: "year" }],
    ["2026-11", { date: "2026-11-01", precision: "month" }],
    ["2026-11-04", { date: "2026-11-04", precision: "day" }],
    ["  2026-11-04 ", { date: "2026-11-04", precision: "day" }], // trims whitespace
    ["2028-02-29", { date: "2028-02-29", precision: "day" }], // 2028 is a leap year
  ])("%j -> %j", (raw, expected) => {
    expect(normalizePublishedDate(raw)).toEqual(expected);
  });

  it.each([
    "", // empty
    "Nov 2026", // not ISO
    "2026-13", // month 13
    "2026-00", // month 0
    "2026-02-30", // no Feb 30
    "2027-02-29", // 2027 is not a leap year
    "0999", // year below 1000
    "2026-1-4", // not zero-padded
    "2026-11-04T00:00:00Z", // timestamps are not one of the three shapes
  ])("rejects %j", (raw) => {
    expect(normalizePublishedDate(raw)).toBeNull();
  });
});

describe("periodEnd", () => {
  it("day precision ends the same day", () => {
    expect(periodEnd({ date: "2026-11-04", precision: "day" })).toBe("2026-11-04");
  });
  it("month precision ends on the last day of the month (30-day month)", () => {
    expect(periodEnd({ date: "2026-11-01", precision: "month" })).toBe("2026-11-30");
  });
  it("month precision handles leap-year February", () => {
    expect(periodEnd({ date: "2028-02-01", precision: "month" })).toBe("2028-02-29");
  });
  it("year precision ends on Dec 31", () => {
    expect(periodEnd({ date: "2026-01-01", precision: "year" })).toBe("2026-12-31");
  });
});

describe("isUpcoming (today = 2026-11-20)", () => {
  const today = "2026-11-20";
  it.each<[ReleaseDate, boolean]>([
    [{ date: "2026-11-04", precision: "day" }, false], // already out
    [{ date: "2026-11-20", precision: "day" }, true], // out today counts
    [{ date: "2026-11-01", precision: "month" }, true], // "sometime in November" not over yet
    [{ date: "2026-10-01", precision: "month" }, false], // October is over
    [{ date: "2026-01-01", precision: "year" }, true], // "sometime in 2026" not over yet
    [{ date: "2025-01-01", precision: "year" }, false],
  ])("%j -> %s", (release, expected) => {
    expect(isUpcoming(release, today)).toBe(expected);
  });
});

describe("compareReleaseDates", () => {
  it("sorts earliest first, exact dates before vaguer ones on the same start date", () => {
    const input: ReleaseDate[] = [
      { date: "2026-12-01", precision: "day" },
      { date: "2026-11-01", precision: "month" },
      { date: "2026-11-01", precision: "day" },
      { date: "2026-01-01", precision: "year" },
    ];
    const sorted = [...input].sort(compareReleaseDates);
    expect(sorted).toEqual([
      { date: "2026-01-01", precision: "year" },
      { date: "2026-11-01", precision: "day" },
      { date: "2026-11-01", precision: "month" },
      { date: "2026-12-01", precision: "day" },
    ]);
  });
});
