import { describe, expect, it } from "vitest";
import { formatReleaseDate, groupLabel } from "./format";

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
