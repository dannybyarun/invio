import NepaliDate from "nepali-date-converter";

export function isNepaliLocale(locale?: string): boolean {
  return String(locale || "").toLowerCase().split("-")[0] === "ne";
}

export function numberFormatLocale(
  locale: string | undefined,
  numberFormat: "comma" | "period" = "comma",
): string {
  if (isNepaliLocale(locale)) {
    return numberFormat === "period" ? "de-NP-u-nu-deva" : "ne-NP";
  }
  return numberFormat === "period" ? "de-DE" : "en-US";
}

function formatGregorianDate(
  date: Date,
  locale: string,
  dateFormat?: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (options) return new Intl.DateTimeFormat(locale, options).format(date);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return dateFormat === "DD.MM.YYYY"
    ? `${day}.${month}.${year}`
    : `${year}-${month}-${day}`;
}

/**
 * Formats the stored Gregorian date and, for Nepali users, appends its
 * Bikram Sambat equivalent. Storage, form values, APIs, and XML remain AD.
 */
export function formatDateWithBs(
  value: string | Date | undefined | null,
  locale?: string,
  dateFormat?: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!value) return "";
  const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? (() => {
        const [year, month, day] = value.split("-").map(Number);
        return new Date(year, month - 1, day);
      })()
    : typeof value === "string"
      ? new Date(value)
      : value;
  if (Number.isNaN(date.getTime())) return "";

  const activeLocale = isNepaliLocale(locale) ? "ne-NP" : locale || "en-US";
  const gregorian = formatGregorianDate(date, activeLocale, dateFormat, options);
  if (!isNepaliLocale(locale)) return gregorian;

  try {
    const bs = new NepaliDate(date).format("YYYY-MM-DD", "np");
    return `${gregorian} (वि.सं. ${bs})`;
  } catch {
    // The converter has a finite supported range. Never hide the AD date.
    return gregorian;
  }
}
