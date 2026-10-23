import { describe, expect, it } from "vitest";
import {
  bpsToPercent,
  categoryChanges,
  createCategoryInput,
  parseWholeNumber,
  percentToBps,
  settingsChanges,
} from "./form-model";

describe("percent and basis points (BR-28)", () => {
  it("converts a whole percent with integer math", () => {
    expect(percentToBps("5")).toEqual({ ok: true, value: 500 });
    expect(percentToBps(" 100 ")).toEqual({ ok: true, value: 10_000 });
    expect(percentToBps("0")).toEqual({ ok: true, value: 0 });
  });

  it("refuses a decimal, a sign, and an empty entry", () => {
    expect(percentToBps("2.5")).toEqual({ ok: false, kind: "invalid" });
    expect(percentToBps("-1")).toEqual({ ok: false, kind: "invalid" });
    expect(percentToBps("1e2")).toEqual({ ok: false, kind: "invalid" });
    expect(percentToBps("")).toEqual({ ok: false, kind: "required" });
    expect(percentToBps("1000")).toEqual({ ok: false, kind: "tooLong" });
  });

  it("shows stored basis points as a whole percent", () => {
    expect(bpsToPercent(500)).toBe("5");
    expect(bpsToPercent(0)).toBe("0");
    expect(bpsToPercent(10_000)).toBe("100");
  });
});

describe("parseWholeNumber", () => {
  it("reads digits only", () => {
    expect(parseWholeNumber("12", 7)).toEqual({ ok: true, value: 12 });
    expect(parseWholeNumber("1,2", 7)).toEqual({ ok: false, kind: "invalid" });
    expect(parseWholeNumber("12345678", 7)).toEqual({ ok: false, kind: "tooLong" });
  });
});

describe("createCategoryInput", () => {
  it("leaves a blank sort order out so the category goes last", () => {
    expect(createCategoryInput("เสื้อผ้า", "  ")).toEqual({ name: "เสื้อผ้า" });
  });

  it("sends a number, or the text itself when it is not one", () => {
    expect(createCategoryInput("x", "7")).toEqual({ name: "x", sortOrder: 7 });
    expect(createCategoryInput("x", "7.5")).toEqual({ name: "x", sortOrder: "7.5" });
  });
});

describe("categoryChanges", () => {
  const saved = { name: "เสื้อผ้า", sortOrder: 3 };

  it("sends nothing when nothing differs", () => {
    expect(categoryChanges(saved, { name: "เสื้อผ้า", sortOrderText: "3" })).toEqual({});
    expect(categoryChanges(saved, { name: " เสื้อผ้า ", sortOrderText: " 3 " })).toEqual({});
  });

  it("sends only what differs", () => {
    expect(categoryChanges(saved, { name: "ใหม่", sortOrderText: "3" })).toEqual({ name: "ใหม่" });
    expect(categoryChanges(saved, { name: "เสื้อผ้า", sortOrderText: "0" })).toEqual({
      sortOrder: 0,
    });
  });

  it("passes on a sort order it cannot read", () => {
    expect(categoryChanges(saved, { name: "เสื้อผ้า", sortOrderText: "x" })).toEqual({
      sortOrder: "x",
    });
  });
});

describe("settingsChanges", () => {
  const saved = { flatShippingFeeSatang: 4000, commissionRateBps: 500 };

  it("sends nothing when nothing differs", () => {
    expect(settingsChanges(saved, { feeText: "40", percentText: "5" })).toEqual({});
    expect(settingsChanges(saved, { feeText: "40.00", percentText: "5" })).toEqual({});
  });

  it("converts baht to integer satang and percent to basis points", () => {
    expect(settingsChanges(saved, { feeText: "49.50", percentText: "7" })).toEqual({
      flatShippingFeeSatang: 4950,
      commissionRateBps: 700,
    });
    expect(settingsChanges(saved, { feeText: "0", percentText: "5" })).toEqual({
      flatShippingFeeSatang: 0,
    });
  });

  it("avoids float error on money", () => {
    expect(settingsChanges(saved, { feeText: "0.29", percentText: "5" })).toEqual({
      flatShippingFeeSatang: 29,
    });
    expect(settingsChanges(saved, { feeText: "1000", percentText: "5" })).toEqual({
      flatShippingFeeSatang: 100_000,
    });
  });

  it("passes on text it cannot read, for the schema to refuse", () => {
    expect(settingsChanges(saved, { feeText: "4o", percentText: "2.5" })).toEqual({
      flatShippingFeeSatang: "4o",
      commissionRateBps: "2.5",
    });
  });
});
