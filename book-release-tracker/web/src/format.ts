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

/**
 * Groups releases under headings for display, keeping each heading once.
 * The API sorts a year-only release ("sometime in 2027") as 1 Jan 2027, its
 * earliest possible date; shown in that spot it would split "January 2027"
 * in two. So on the page, a year-only group goes after the last month of that
 * year that is on the page. The API order (and pagination) is unchanged.
 */
export function groupReleases<T extends { releaseDate: string; datePrecision: DatePrecision }>(
  items: T[],
): { label: string; items: T[] }[] {
  const byLabel = new Map<string, { label: string; year: string; yearOnly: boolean; items: T[] }>();
  for (const r of items) {
    const label = groupLabel(r.releaseDate, r.datePrecision);
    let g = byLabel.get(label);
    if (!g) {
      g = { label, year: r.releaseDate.slice(0, 4), yearOnly: r.datePrecision === "year", items: [] };
      byLabel.set(label, g);
    }
    g.items.push(r);
  }
  const months = [...byLabel.values()].filter((g) => !g.yearOnly);
  const years = [...byLabel.values()].filter((g) => g.yearOnly);
  const out = [...months];
  for (const y of years) {
    // after the last month group of the same year (or before the first later year)
    let at = out.length;
    for (let i = out.length - 1; i >= 0; i--) {
      if ((out[i] as { year: string }).year <= y.year) {
        at = i + 1;
        break;
      }
      at = i;
    }
    out.splice(at, 0, y);
  }
  return out.map(({ label, items: groupItems }) => ({ label, items: groupItems }));
}
