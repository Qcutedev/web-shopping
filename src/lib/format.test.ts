import { describe, expect, it } from "vitest";
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

describe("formatDate and formatDateTime", () => {
  // 17:30 UTC on 13 October is 00:30 on 14 October in Bangkok (UTC+7, no daylight saving).
  const instant = "2026-10-13T17:30:00Z";

  it("shows the Bangkok day, not the UTC day", () => {
    expect(formatDate(instant)).toBe("14 ต.ค. 2569");
  });

  it("shows the Bangkok time of day", () => {
    expect(formatDateTime(instant)).toBe("14 ต.ค. 2569 00:30");
  });

  it("keeps the day before midnight in Bangkok", () => {
    expect(formatDateTime("2026-10-13T16:59:00Z")).toBe("13 ต.ค. 2569 23:59");
  });

  it("accepts a Date and epoch milliseconds the same as an ISO string", () => {
    const date = new Date(instant);
    expect(formatDate(date)).toBe(formatDate(instant));
    expect(formatDateTime(date.getTime())).toBe(formatDateTime(instant));
  });

  it("does not depend on the process time zone", () => {
    // The formatter fixes the time zone itself; a different offset must not move the result.
    const previous = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(formatDateTime(instant)).toBe("14 ต.ค. 2569 00:30");
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it("throws on an invalid date instead of showing a guess", () => {
    expect(() => formatDate("not a date")).toThrow(RangeError);
    expect(() => formatDateTime(Number.NaN)).toThrow(RangeError);
  });
});
