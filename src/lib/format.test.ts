import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDate, formatDateTime, formatMoney } from "./format";

describe("formatMoney", () => {
  it.each([
    [0, "฿0.00"],
    [1, "฿0.01"],
    [29000, "฿290.00"],
    [123456789, "฿1,234,567.89"],
    [-4000, "-฿40.00"],
  ])("formats %i satang as %s", (satang, expected) => {
    expect(formatMoney(satang)).toBe(expected);
  });

  it("refuses a value that is not an integer number of satang", () => {
    expect(() => formatMoney(10.5)).toThrow(RangeError);
    expect(() => formatMoney(Number.NaN)).toThrow(RangeError);
  });
});

// The calendar year of th-TH is Buddhist (2569) unless the owner picks Gregorian (open question
// Q43), so the tests accept either and pin only the day, month, and time that Bangkok decides.
const YEAR = "(?:2569|2026)";

describe("formatDate and formatDateTime", () => {
  // 17:30 UTC on 13 October is 00:30 on 14 October in Bangkok (UTC+7, no daylight saving).
  const instant = "2026-10-13T17:30:00Z";

  it("shows the Bangkok day, not the UTC day", () => {
    expect(formatDate(instant)).toMatch(new RegExp(`^14 ต\.ค\. ${YEAR}$`));
  });

  it("shows the Bangkok time of day", () => {
    expect(formatDateTime(instant)).toMatch(new RegExp(`^14 ต\.ค\. ${YEAR} 00:30$`));
  });

  it("keeps the day before midnight in Bangkok", () => {
    expect(formatDateTime("2026-10-13T16:59:00Z")).toMatch(new RegExp(`^13 ต\.ค\. ${YEAR} 23:59$`));
  });

  it("accepts a Date and epoch milliseconds the same as an ISO string", () => {
    const date = new Date(instant);
    expect(formatDate(date)).toBe(formatDate(instant));
    expect(formatDateTime(date.getTime())).toBe(formatDateTime(instant));
  });

  it("throws on an invalid date instead of showing a guess", () => {
    expect(() => formatDate("not a date")).toThrow(RangeError);
    expect(() => formatDateTime(Number.NaN)).toThrow(RangeError);
  });
});

describe("display time zone", () => {
  const instant = "2026-10-13T17:30:00Z";
  const previous = process.env.TZ;

  afterEach(() => {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
    vi.resetModules();
  });

  // The formatters are built when the module loads, so the module is loaded again after TZ
  // changes. The machine's own zone may already be Asia/Bangkok, so two other zones are tried:
  // a formatter without its own timeZone would follow them and fail.
  it.each(["America/Los_Angeles", "UTC"])(
    "shows Bangkok time when the process time zone is %s",
    async (zone) => {
      process.env.TZ = zone;
      vi.resetModules();
      const fresh = await import("./format");
      expect(fresh.formatDateTime(instant)).toMatch(new RegExp(`^14 ต\.ค\. ${YEAR} 00:30$`));
      expect(fresh.formatDate(instant)).toMatch(new RegExp(`^14 ต\.ค\. ${YEAR}$`));
    },
  );
});
