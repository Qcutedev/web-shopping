import { describe, expect, it } from "vitest";
import { formatSatang } from "./format-price";

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
