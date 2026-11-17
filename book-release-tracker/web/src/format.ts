import type { DatePrecision } from "./api/schemas";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Shows a release date only as precisely as it is known:
 *   ("2026-11-04", "day")   -> "4 Nov 2026"
 *   ("2026-11-01", "month") -> "Nov 2026"
 *   ("2027-01-01", "year")  -> "2027"
 * Plain string handling, no Date objects, so no time-zone shift is possible.
 */
export function formatReleaseDate(date: string, precision: DatePrecision): string {
  const [y, m, d] = date.split("-");
  const month = MONTHS[Number(m) - 1] ?? "";
  switch (precision) {
    case "year":
      return `${y}`;
    case "month":
      return `${month} ${y}`;
    case "day":
      return `${Number(d)} ${month} ${y}`;
  }
}

/** Heading the calendar groups a release under. Year-only releases get their own group. */
export function groupLabel(date: string, precision: DatePrecision): string {
  const [y, m] = date.split("-");
  return precision === "year" ? `Sometime in ${y}` : `${MONTHS_LONG[Number(m) - 1] ?? ""} ${y}`;
}
