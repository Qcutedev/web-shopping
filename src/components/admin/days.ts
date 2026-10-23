/**
 * Calendar days in Asia/Bangkok as the instants that bound them (API_CONTRACTS 1.6). The admin
 * types days; the endpoints take half-open ranges of instants, `from` inclusive and `to` exclusive.
 * Thailand has no daylight saving time, so Bangkok is always UTC+07:00.
 */
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The parts of a real calendar day, or `null` for anything else (including 2026-02-30). */
function parseDay(text: string): { y: number; m: number; d: number } | null {
  const match = DAY.exec(text);
  if (match === null) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

/** The instant a Bangkok day starts, for example `2026-10-11` to `2026-10-11T00:00:00+07:00`. */
export function bangkokDayStart(day: string): string | null {
  return parseDay(day) === null ? null : `${day}T00:00:00+07:00`;
}

/**
 * The instant a Bangkok day ends, which is when the next day starts: the exclusive end of a range
 * whose last day is included.
 */
export function bangkokDayEnd(day: string): string | null {
  const parts = parseDay(day);
  if (parts === null) return null;
  const next = new Date(Date.UTC(parts.y, parts.m - 1, parts.d + 1)).toISOString().slice(0, 10);
  return `${next}T00:00:00+07:00`;
}

/** True when `text` is a real calendar day written `YYYY-MM-DD`. */
export function isDay(text: string): boolean {
  return parseDay(text) !== null;
}
