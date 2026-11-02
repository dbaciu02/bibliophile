/**
 * Core calculation (Q1): turning Google Books' `publishedDate` into something
 * we can store, sort and filter.
 *
 * Google Books gives one of three shapes:  "2026"  |  "2026-11"  |  "2026-11-04"
 * We store the FIRST day of that period plus how precise it is:
 *
 *   "2026"       -> { date: "2026-01-01", precision: "year"  }
 *   "2026-11"    -> { date: "2026-11-01", precision: "month" }
 *   "2026-11-04" -> { date: "2026-11-04", precision: "day"   }
 *
 * All dates are plain "YYYY-MM-DD" strings (no time zone), which compare
 * correctly with < and > because the format is fixed-width.
 */

export type DatePrecision = "year" | "month" | "day";

export interface ReleaseDate {
  date: string; // YYYY-MM-DD, first day of the period
  precision: DatePrecision;
}

const PATTERN = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

function isRealDate(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** Returns null for anything that isn't one of the three shapes or isn't a real date. */
export function normalizePublishedDate(raw: string): ReleaseDate | null {
  const m = PATTERN.exec(raw.trim());
  if (!m) return null;

  const year = Number(m[1]);
  if (year < 1000) return null;
  const month = m[2] === undefined ? undefined : Number(m[2]);
  const day = m[3] === undefined ? undefined : Number(m[3]);

  if (month === undefined) {
    return { date: `${pad(year, 4)}-01-01`, precision: "year" };
  }
  if (month < 1 || month > 12) return null;
  if (day === undefined) {
    return { date: `${pad(year, 4)}-${pad(month, 2)}-01`, precision: "month" };
  }
  if (!isRealDate(year, month, day)) return null; // e.g. 2026-02-30
  return { date: `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`, precision: "day" };
}

/** Last day of the period a release date covers. */
export function periodEnd({ date, precision }: ReleaseDate): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  switch (precision) {
    case "day":
      return date;
    case "month": {
      // Day 0 of the next month is the last day of this month (handles leap years).
      const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return `${date.slice(0, 7)}-${pad(last, 2)}`;
    }
    case "year":
      return `${date.slice(0, 4)}-12-31`;
  }
}

/**
 * Is this release still upcoming (or out today) as of `today` (YYYY-MM-DD)?
 * A vague date counts as upcoming until its whole period has passed:
 * a book dated "2026-11" is still upcoming on 2026-11-20.
 */
export function isUpcoming(release: ReleaseDate, today: string): boolean {
  return periodEnd(release) >= today;
}

const PRECISION_ORDER: Record<DatePrecision, number> = { day: 0, month: 1, year: 2 };

/** Sort order for the calendar: earliest first; on the same start date, exact dates first. */
export function compareReleaseDates(a: ReleaseDate, b: ReleaseDate): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return PRECISION_ORDER[a.precision] - PRECISION_ORDER[b.precision];
}
