/**
 * Strict date handling. Dates are plain calendar days ("YYYY-MM-DD"), never
 * timestamps, so there is no timezone drift. Unparseable input returns null —
 * callers must reject the row rather than substitute "today".
 */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function valid(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null; // rejects 31 Feb etc.
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function fullYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

export type DateOptions = {
  /** true (default, India): 03/04/2026 is 3 April. false: 3 March. */
  dayFirst?: boolean;
};

export function parseDate(value: unknown, opts: DateOptions = {}): string | null {
  const dayFirst = opts.dayFirst ?? true;

  if (value instanceof Date) {
    if (Number.isNaN(value.valueOf())) return null;
    // Spreadsheet date cells arrive as UTC midnight; use UTC parts to avoid shifting a day.
    return valid(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }

  if (typeof value === "number") {
    // Excel serial date (1900 system). 25569 = 1970-01-01.
    if (value > 20000 && value < 80000) {
      const ms = Math.round((value - 25569) * 86400 * 1000);
      const dt = new Date(ms);
      return valid(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    }
    return null;
  }

  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;

  // ISO: 2026-04-03 or 2026-04-03T10:00:00
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (m) return valid(+m[1], +m[2], +m[3]);

  // Numeric with separators: 03/04/2026, 3-4-26, 03.04.2026
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})(?:[T\s].*)?$/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const y = fullYear(+m[3]);
    if (dayFirst) {
      // If the "month" slot is > 12 the value can only be month-first.
      return b > 12 && a <= 12 ? valid(y, a, b) : valid(y, b, a);
    }
    return a > 12 && b <= 12 ? valid(y, b, a) : valid(y, a, b);
  }

  // 03 Apr 2026, 3-Apr-26, 03/Apr/2026
  m = s.match(/^(\d{1,2})[\s\-/.,]*([A-Za-z]{3,9})[\s\-/.,]*(\d{2}|\d{4})$/);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
    return mon ? valid(fullYear(+m[3]), mon, +m[1]) : null;
  }

  // Apr 3, 2026
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()];
    return mon ? valid(+m[3], mon, +m[2]) : null;
  }

  return null;
}

export function isWeekend(isoDate: string): boolean {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** Whole days between two ISO dates (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
