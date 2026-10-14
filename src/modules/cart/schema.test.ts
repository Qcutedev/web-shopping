/**
 * The cart request schemas (docs/API_CONTRACTS.md sections 1.1, 5.4; BR-03).
 */
import { describe, expect, it } from "vitest";

import {
  addCartItemBodySchema,
  cartItemIdParamsSchema,
  MAX_ID_LENGTH,
  updateCartItemBodySchema,
} from "./schema";

describe("addCartItemBodySchema", () => {
  it("accepts a product id and a quantity from 1 to 99", () => {
    expect(addCartItemBodySchema.parse({ productId: "p1", quantity: 1 })).toEqual({
      productId: "p1",
      quantity: 1,
    });
    expect(addCartItemBodySchema.parse({ productId: "p1", quantity: 99 }).quantity).toBe(99);
  });

  it("refuses a quantity outside 1 to 99, a fraction, a string, or none (BR-03)", () => {
    for (const quantity of [0, -1, 100, 1.5, "2", null, true, Number.NaN]) {
      expect(addCartItemBodySchema.safeParse({ productId: "p1", quantity }).success).toBe(false);
    }
    expect(addCartItemBodySchema.safeParse({ productId: "p1" }).success).toBe(false);
  });

  it("refuses any amount, user, store, or cart key: an amount is refused, never used (D-031 point 3)", () => {
    for (const key of [
      "priceSatang",
      "unitPriceSatang",
      "lineTotalSatang",
      "grandTotalSatang",
      "shippingFeeSatang",
      "userId",
      "storeId",
      "cartId",
      "stock",
    ]) {
      const result = addCartItemBodySchema.safeParse({ productId: "p1", quantity: 1, [key]: 1 });
      expect(result.success, key).toBe(false);
      expect(result.error?.issues[0]?.code).toBe("unrecognized_keys");
    }
  });

  it("refuses an empty, over-long, NUL, or lone-surrogate product id", () => {
    for (const productId of ["", "x".repeat(MAX_ID_LENGTH + 1), "a\u0000b", "a\ud800", 42]) {
      expect(addCartItemBodySchema.safeParse({ productId, quantity: 1 }).success).toBe(false);
    }
    expect(
      addCartItemBodySchema.safeParse({ productId: "x".repeat(MAX_ID_LENGTH), quantity: 1 })
        .success,
    ).toBe(true);
  });
});

describe("updateCartItemBodySchema", () => {
  it("takes the quantity only", () => {
    expect(updateCartItemBodySchema.parse({ quantity: 5 })).toEqual({ quantity: 5 });
    expect(updateCartItemBodySchema.safeParse({}).success).toBe(false);
    expect(updateCartItemBodySchema.safeParse({ quantity: 5, productId: "p" }).success).toBe(false);
    expect(updateCartItemBodySchema.safeParse({ quantity: 100 }).success).toBe(false);
    expect(updateCartItemBodySchema.safeParse({ quantity: 0 }).success).toBe(false);
  });
});

describe("cartItemIdParamsSchema", () => {
  it("validates the form of the id only", () => {
    expect(cartItemIdParamsSchema.parse({ itemId: "line_1" })).toEqual({ itemId: "line_1" });
    expect(cartItemIdParamsSchema.safeParse({ itemId: "" }).success).toBe(false);
    expect(cartItemIdParamsSchema.safeParse({ itemId: "x".repeat(201) }).success).toBe(false);
  });
});
