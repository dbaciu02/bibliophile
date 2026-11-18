import { describe, expect, it } from "vitest";
import { formatReleaseDate, groupLabel, groupReleases } from "./format";

describe("formatReleaseDate shows a date only as precisely as it is known", () => {
  it.each([
    ["2026-11-04", "day", "4 Nov 2026"],
    ["2026-11-01", "month", "Nov 2026"],
    ["2027-01-01", "year", "2027"],
    ["2028-02-29", "day", "29 Feb 2028"],
  ] as const)("%s (%s) -> %s", (date, precision, expected) => {
    expect(formatReleaseDate(date, precision)).toBe(expected);
  });
});

describe("groupLabel", () => {
  it("groups day and month releases by month, year-only releases separately", () => {
    expect(groupLabel("2026-11-04", "day")).toBe("November 2026");
    expect(groupLabel("2026-11-01", "month")).toBe("November 2026");
    expect(groupLabel("2027-01-01", "year")).toBe("Sometime in 2027");
  });
});

describe("groupReleases", () => {
  const r = (releaseDate: string, datePrecision: "year" | "month" | "day", title: string) => ({ releaseDate, datePrecision, title });

  it("keeps each heading once and puts 'Sometime in YYYY' after that year's months", () => {
    // the order the API returns: year-only sorts as 1 Jan
    const groups = groupReleases([
      r("2026-12-09", "day", "Dec book"),
      r("2027-01-01", "month", "Jan (month only)"),
      r("2027-01-01", "year", "2027 (year only)"),
      r("2027-01-20", "day", "Jan 20 book"),
      r("2027-02-03", "day", "Feb book"),
      r("2028-01-01", "year", "2028 (year only)"),
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      "December 2026",
      "January 2027",
      "February 2027",
      "Sometime in 2027",
      "Sometime in 2028",
    ]);
    expect(groups[1]?.items.map((i) => i.title)).toEqual(["Jan (month only)", "Jan 20 book"]);
  });

  it("a year-only group with no months of that year on the page stays in date order", () => {
    const groups = groupReleases([r("2026-11-30", "day", "a"), r("2027-01-01", "year", "b"), r("2028-03-01", "day", "c")]);
    expect(groups.map((g) => g.label)).toEqual(["November 2026", "Sometime in 2027", "March 2028"]);
  });
});
