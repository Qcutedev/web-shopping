/**
 * Shared display formatters (CLAUDE.md, Language; REQ-N-01).
 *
 * Money: integer satang to Thai baht through `formatSatang`, which is also what the `Price`
 * primitive uses, so the whole UI has one money formatter. Dates: `th-TH` locale, Asia/Bangkok
 * time zone; values are stored and passed around as UTC instants and converted only here.
 *
 * `th-TH` uses the Buddhist calendar, so 2026 is displayed as 2569 (the platform's default for
 * the locale). Whether the owner wants that or the Gregorian year is an open question.
 */
import { formatSatang } from "@/components/ui/format-price";

export { formatSatang as formatMoney };

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
