import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDate, formatDateTime, formatSatang } from "./format";

describe("formatSatang", () => {
  it("formats zero", () => {
    expect(formatSatang(0)).toBe("฿0.00");
  });

  it("formats a single satang", () => {
    expect(formatSatang(1)).toBe("฿0.01");
  });

  it("formats 29000 satang as 290 baht", () => {
    expect(formatSatang(29000)).toBe("฿290.00");
  });

  it("keeps the satang part of an amount", () => {
    expect(formatSatang(12345)).toBe("฿123.45");
    expect(formatSatang(1005)).toBe("฿10.05");
  });

  it("groups thousands in a large value (the 32-bit Int maximum)", () => {
    expect(formatSatang(2_147_483_647)).toBe("฿21,474,836.47");
  });

  it("groups a mid-size value", () => {
    expect(formatSatang(123456789)).toBe("฿1,234,567.89");
  });

  it("stays exact for values where dividing by 100 in floating point is not", () => {
    // 9007199254740991 / 100 cannot be represented exactly as a double.
    expect(formatSatang(Number.MAX_SAFE_INTEGER)).toBe("฿90,071,992,547,409.91");
  });

  it("formats a negative amount with a minus sign", () => {
    expect(formatSatang(-4000)).toBe("-฿40.00");
  });

  it("matches Intl.NumberFormat for th-TH and THB", () => {
    const reference = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" });
    expect(formatSatang(29000)).toBe(reference.format(290));
  });

  it.each([0.5, 290.01, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects %s, which is not an integer number of satang",
    (value) => {
      expect(() => formatSatang(value)).toThrow(RangeError);
    },
  );
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
