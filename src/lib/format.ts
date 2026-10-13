/**
 * Shared display formatters (CLAUDE.md, Language; REQ-N-01).
 *
 * Money: integer satang to Thai baht through `formatSatang`, the single money formatter; the
 * `Price` primitive in `src/components/ui` imports it from here. Dates: `th-TH` locale, Asia/Bangkok
 * time zone; values are stored and passed around as UTC instants and converted only here.
 *
 * `th-TH` uses the Buddhist calendar, so 2026 is displayed as 2569 (the platform's default for
 * the locale). Whether the owner wants that or the Gregorian year is an open question.
 */
const thbFormatter = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" });

/**
 * Formats an amount in integer satang as Thai baht, for example 29000 -> "฿290.00".
 *
 * Money is integer satang everywhere (CLAUDE.md, rule 4). The conversion to baht happens only
 * here, and without floating-point arithmetic: the satang integer is split into baht and satang
 * with integer operations and handed to Intl.NumberFormat as an exact decimal string.
 *
 * Negative integers are formatted with a minus sign. Anything that is not a safe integer
 * (a fraction, NaN, Infinity, or a value beyond Number.MAX_SAFE_INTEGER) throws a RangeError:
 * such a value means a bug upstream, and showing a rounded price would hide it.
 */
export function formatSatang(satang: number): string {
  if (!Number.isSafeInteger(satang)) {
    throw new RangeError(`formatSatang expects an integer number of satang, received ${satang}`);
  }
  const absolute = Math.abs(satang);
  const remainder = absolute % 100;
  // Exact: the dividend is a multiple of 100.
  const baht = (absolute - remainder) / 100;
  const sign = satang < 0 ? "-" : "";
  const decimal: `${number}` =
    `${sign}${baht}.${String(remainder).padStart(2, "0")}` as `${number}`;
  return thbFormatter.format(decimal);
}

const DISPLAY_TIME_ZONE = "Asia/Bangkok";

const dateFormatter = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeZone: DISPLAY_TIME_ZONE,
});

const dateTimeFormatter = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: DISPLAY_TIME_ZONE,
});

/** A UTC instant: a `Date`, an ISO 8601 string (as the API returns it), or epoch milliseconds. */
export type Instant = Date | string | number;

function toDate(value: Instant): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    // An invalid date means a bug upstream; showing "Invalid Date" or a guess would hide it.
    throw new RangeError("formatDate expects a valid date");
  }
  return date;
}

/** For example "14 ต.ค. 2569". The day is the day in Bangkok, not in UTC. */
export function formatDate(value: Instant): string {
  return dateFormatter.format(toDate(value));
}

/** For example "14 ต.ค. 2569 00:30". Time of day in Bangkok. */
export function formatDateTime(value: Instant): string {
  return dateTimeFormatter.format(toDate(value));
}
