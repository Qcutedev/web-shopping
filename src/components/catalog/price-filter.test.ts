import { describe, expect, it } from "vitest";
import { applyPriceFilter, parseBaht, satangToBaht } from "./price-filter";
import { parseListQuery } from "./list-query";

describe("parseBaht", () => {
  it.each([
    ["", undefined],
    ["  ", undefined],
    ["0", 0],
    ["100", 10000],
    ["99.5", 9950],
    ["99.05", 9905],
    ["0.29", 29],
    ["1000000", 100000000],
  ])("accepts %j", (text, satang) => {
    expect(parseBaht(text)).toEqual({ ok: true, satang });
  });

  it.each(["-1", "1e3", "abc", "1,000", "1.234", "1.", ".5", "1000000.01", "99999999", "０"])(
    "refuses %j",
    (text) => {
      expect(parseBaht(text)).toEqual({ ok: false });
    },
  );

  it("does not lose a satang to float error", () => {
    expect(parseBaht("19.99")).toEqual({ ok: true, satang: 1999 });
    expect(parseBaht("0.07")).toEqual({ ok: true, satang: 7 });
  });
});

describe("satangToBaht", () => {
  it("round trips", () => {
    expect(satangToBaht(10000)).toBe("100");
    expect(satangToBaht(9950)).toBe("99.5");
    expect(satangToBaht(9905)).toBe("99.05");
    expect(satangToBaht(7)).toBe("0.07");
  });
});

describe("applyPriceFilter", () => {
  it("turns baht into satang and drops the baht fields", () => {
    const result = applyPriceFilter({ minPrice: "10", maxPrice: "99.5", q: "ชา" });
    expect(result.raw).toEqual({ q: "ชา", minPriceSatang: "1000", maxPriceSatang: "9950" });
    expect(result.errors).toEqual([]);
    expect(parseListQuery(result.raw)).toMatchObject({
      minPriceSatang: 1000,
      maxPriceSatang: 9950,
    });
  });

  it("treats blank fields as no bound and clears a satang bound from the link", () => {
    const result = applyPriceFilter({ minPrice: "", maxPriceSatang: "500" });
    expect(result.raw.minPriceSatang).toBeUndefined();
    expect(result.maxText).toBe("5");
  });

  it("reports an invalid entry, echoes it, and drops the bound", () => {
    const result = applyPriceFilter({ minPrice: "-5", maxPrice: "50" });
    expect(result.errors).toEqual(["min-invalid"]);
    expect(result.minText).toBe("-5");
    expect(result.raw.minPriceSatang).toBeUndefined();
    expect(result.raw.maxPriceSatang).toBe("5000");
  });

  it("refuses a repeated field", () => {
    expect(applyPriceFilter({ minPrice: ["1", "2"] }).errors).toEqual(["min-invalid"]);
  });

  it("reports min above max and drops both so the page still renders", () => {
    const result = applyPriceFilter({ minPrice: "500", maxPrice: "100" });
    expect(result.errors).toEqual(["range"]);
    expect(result.raw.minPriceSatang).toBeUndefined();
    expect(result.raw.maxPriceSatang).toBeUndefined();
    expect(parseListQuery(result.raw)).not.toBeNull();
  });

  it("shows satang parameters of a sort link in baht", () => {
    const result = applyPriceFilter({ minPriceSatang: "12050", maxPriceSatang: "20000" });
    expect(result.minText).toBe("120.5");
    expect(result.maxText).toBe("200");
    expect(result.errors).toEqual([]);
  });
});
