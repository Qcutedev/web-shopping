import { describe, expect, it } from "vitest";
import { fill } from "./fill";
import { th } from "./th";

describe("fill", () => {
  it("replaces every occurrence of a placeholder in the approved lowered-quantity text", () => {
    expect(fill(th.quantity.lowered, { available: 4 })).toBe(
      "สินค้าเหลือ 4 ชิ้น ระบบปรับจำนวนเป็น 4 ชิ้นให้แล้ว",
    );
  });

  it("fills the returned-quantity text", () => {
    expect(fill(th.cart.returnedQuantityCut, { quantity: 99 })).toBe(
      "ปรับจำนวนในตะกร้าเป็น 99 ชิ้น",
    );
  });

  it("leaves a text without placeholders unchanged", () => {
    expect(fill(th.order.paymentFailed, {})).toBe("ชำระเงินไม่สำเร็จ");
  });

  it("throws for a placeholder with no value", () => {
    expect(() => fill(th.quantity.lowered, {})).toThrow(/available/);
  });

  it("throws for a number that is not finite", () => {
    expect(() => fill(th.quantity.lowered, { available: Number.NaN })).toThrow(RangeError);
  });

  it.each([1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "throws for the number %s, which is not a whole number",
    (value) => {
      expect(() => fill(th.quantity.lowered, { available: value })).toThrow(RangeError);
    },
  );

  it("does not treat inherited object keys as values", () => {
    expect(() => fill("{toString}", {})).toThrow();
  });
});
