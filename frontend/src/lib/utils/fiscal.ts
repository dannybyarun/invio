import NepaliDate from "nepali-date-converter";
import { isNepaliLocale } from "./dates";

export interface BsParts {
  year: number;
  /** 0 = Baisakh, 1 = Jestha, 2 = Ashadh, 3 = Shrawan, ... 11 = Chaitra */
  month: number;
  date: number;
  day: number;
}

export const BS_MONTHS_EN = [
  "Baisakh",
  "Jestha",
  "Ashadh",
  "Shrawan",
  "Bhadra",
  "Ashwin",
  "Kartik",
  "Mangsir",
  "Poush",
  "Magh",
  "Falgun",
  "Chaitra",
] as const;

export const BS_MONTHS_NP = [
  "वैशाख",
  "जेठ",
  "असार",
  "साउन",
  "भदौ",
  "असोज",
  "कात्तिक",
  "मंसिर",
  "पुष",
  "माघ",
  "फागुन",
  "चैत",
] as const;

export function bsMonthName(monthIndex: number, locale?: string): string {
  const idx = ((monthIndex % 12) + 12) % 12;
  return isNepaliLocale(locale) ? BS_MONTHS_NP[idx] : BS_MONTHS_EN[idx];
}

/** Parse an invoice date value the same way the rest of the app does (YYYY-MM-DD as local). */
export function parseDateValue(
  value: string | Date | undefined | null,
): Date | null {
  if (!value) return null;
  const date =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? (() => {
          const [year, month, day] = value.split("-").map(Number);
          return new Date(year, month - 1, day);
        })()
      : typeof value === "string"
        ? new Date(value)
        : value;
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Convert an AD date to its Bikram Sambat parts (null when outside the supported range). */
export function toBs(value: string | Date): BsParts | null {
  const date = parseDateValue(value);
  if (!date) return null;
  try {
    const bs = new NepaliDate(date).getBS();
    return {
      year: Number(bs.year) || 0,
      month: Number(bs.month) || 0,
      date: Number(bs.date) || 0,
      day: Number(bs.day) || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Nepali fiscal year of an AD date. The fiscal year starts on Shrawan 1
 * (BS month index 3) and ends on the last day of Ashadh (month index 2),
 * so Baisakh–Ashadh belong to the previous fiscal year.
 */
export function nepaliFiscalYear(value: string | Date): number | null {
  const bs = toBs(value);
  if (!bs) return null;
  return bs.month >= 3 ? bs.year : bs.year - 1;
}

/** Label like "2081/82" for a Nepali fiscal year. */
export function fiscalYearLabel(fy: number): string {
  return `${fy}/${String((fy + 1) % 100).padStart(2, "0")}`;
}

/** AD range of a Nepali fiscal year: Shrawan 1 of `fy` through Ashadh end. */
export function fiscalYearRange(fy: number): { start: Date; end: Date } | null {
  try {
    const start = new NepaliDate(fy, 3, 1).toJsDate();
    const end = new NepaliDate(fy + 1, 3, 1).toJsDate();
    end.setMilliseconds(end.getMilliseconds() - 1);
    return { start, end };
  } catch {
    return null;
  }
}

export interface FiscalMonth {
  /** Index within the fiscal year: 0 = Shrawan ... 8 = Chaitra, 9 = Baisakh ... 11 = Ashadh */
  fyMonth: number;
  /** BS month index (0 = Baisakh ... 11 = Chaitra) */
  bsMonth: number;
  start: Date;
  end: Date;
}

/** The 12 BS months of a fiscal year in fiscal order (Shrawan first, Ashadh last). */
export function fiscalYearMonths(fy: number): FiscalMonth[] {
  const order = [3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2];
  const months: FiscalMonth[] = [];
  for (let fyMonth = 0; fyMonth < order.length; fyMonth++) {
    const bsMonth = order[fyMonth];
    try {
      const yearForMonth = bsMonth >= 3 ? fy : fy + 1;
      const start = new NepaliDate(yearForMonth, bsMonth, 1).toJsDate();
      const next =
        bsMonth === 11
          ? new NepaliDate(yearForMonth + 1, 0, 1).toJsDate()
          : new NepaliDate(yearForMonth, bsMonth + 1, 1).toJsDate();
      months.push({
        fyMonth,
        bsMonth,
        start,
        end: new Date(next.getTime() - 1),
      });
    } catch {
      /* skip months outside the converter's supported range */
    }
  }
  return months;
}

export function inFiscalYear(
  value: string | Date | undefined,
  fy: number,
): boolean {
  if (!value) return false;
  return nepaliFiscalYear(value) === fy;
}

export function inBsYear(
  value: string | Date | undefined,
  year: number,
): boolean {
  if (!value) return false;
  return toBs(value)?.year === year;
}

export function inBsMonth(
  value: string | Date | undefined,
  year: number,
  month: number,
): boolean {
  if (!value) return false;
  const bs = toBs(value);
  return bs?.year === year && bs?.month === month;
}

/** True when the value falls in the Monday-start week containing `anchor`. */
export function inWeekOf(
  value: string | Date | undefined,
  anchor: string | Date,
): boolean {
  const date = parseDateValue(value);
  const a = parseDateValue(anchor);
  if (!date || !a) return false;
  const mondayOffset = (a.getDay() + 6) % 7;
  const start = new Date(
    a.getFullYear(),
    a.getMonth(),
    a.getDate() - mondayOffset,
  );
  const end = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + 6,
    23,
    59,
    59,
    999,
  );
  return date >= start && date <= end;
}

export function inDay(
  value: string | Date | undefined,
  target: string | Date,
): boolean {
  const date = parseDateValue(value);
  const t = parseDateValue(target);
  if (!date || !t) return false;
  return (
    date.getFullYear() === t.getFullYear() &&
    date.getMonth() === t.getMonth() &&
    date.getDate() === t.getDate()
  );
}

export function inRange(
  value: string | Date | undefined,
  from: string | Date | undefined,
  to: string | Date | undefined,
): boolean {
  const date = parseDateValue(value);
  if (!date) return false;
  const f = parseDateValue(from);
  if (f) {
    f.setHours(0, 0, 0, 0);
    if (date < f) return false;
  }
  const t = parseDateValue(to);
  if (t) {
    t.setHours(23, 59, 59, 999);
    if (date > t) return false;
  }
  return true;
}

/** Current Nepali fiscal year (based on today's date). */
export function currentFiscalYear(): number {
  return nepaliFiscalYear(new Date()) ?? new Date().getFullYear() + 57;
}

/** Today's BS year / month, with sensible fallbacks. */
export function currentBsParts(): BsParts {
  return (
    toBs(new Date()) ?? {
      year: new Date().getFullYear() + 57,
      month: 0,
      date: 1,
      day: 0,
    }
  );
}

/** "YYYY-MM-DD" for a Date (local), for <input type="date"> values. */
export function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
