import { describe, expect, it } from "vitest";
import { bangkokDayEnd, bangkokDayStart, isDay } from "./days";

describe("Bangkok days (BR-40, REQ-A-07)", () => {
  it("starts a day at midnight in Bangkok", () => {
    expect(bangkokDayStart("2026-10-11")).toBe("2026-10-11T00:00:00+07:00");
    // 2026-10-11T00:00+07:00 is 2026-10-10T17:00Z.
    expect(new Date(bangkokDayStart("2026-10-11")!).toISOString()).toBe("2026-10-10T17:00:00.000Z");
  });

  it("ends a day when the next one starts, so the last day is included", () => {
    expect(bangkokDayEnd("2026-10-11")).toBe("2026-10-12T00:00:00+07:00");
    expect(new Date(bangkokDayEnd("2026-10-11")!).toISOString()).toBe("2026-10-11T17:00:00.000Z");
  });

  it("puts 2026-10-11T16:59:59Z in 11 October and 17:00:00Z in 12 October", () => {
    const start = new Date(bangkokDayStart("2026-10-11")!).getTime();
    const end = new Date(bangkokDayEnd("2026-10-11")!).getTime();
    expect(Date.parse("2026-10-11T16:59:59Z")).toBeGreaterThanOrEqual(start);
    expect(Date.parse("2026-10-11T16:59:59Z")).toBeLessThan(end);
    expect(Date.parse("2026-10-11T17:00:00Z")).toBeGreaterThanOrEqual(end);
  });

  it("rolls over month and year ends", () => {
    expect(bangkokDayEnd("2026-12-31")).toBe("2027-01-01T00:00:00+07:00");
    expect(bangkokDayEnd("2028-02-28")).toBe("2028-02-29T00:00:00+07:00");
  });

  it("refuses text that is not a real day", () => {
    for (const text of ["", "2026-02-30", "2026-13-01", "11/10/2026", "2026-1-1", "0050-01-01"]) {
      expect(isDay(text)).toBe(false);
      expect(bangkokDayStart(text)).toBeNull();
      expect(bangkokDayEnd(text)).toBeNull();
    }
  });
});
