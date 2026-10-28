/**
 * Cart pricing and line state (docs/API_CONTRACTS.md section 5.4; BR-22, BR-30, BR-31, BR-38):
 * pure functions, no database.
 */
import { describe, expect, it } from "vitest";

import {
  assertSatang,
  buildCart,
  type CartLineInput,
  priceLine,
  resolveWriteQuantity,
} from "./pricing";

const STORE_A = { id: "store_a", name: "ร้าน A", slug: "store-a", isSample: false };
const STORE_B = { id: "store_b", name: "ร้าน B", slug: "store-b", isSample: true };

let counter = 0;
function line(overrides: Partial<CartLineInput> = {}): CartLineInput {
  counter += 1;
  return {
    id: `line_${counter}`,
    productId: `product_${counter}`,
    storedQuantity: 2,
    slug: `product-${counter}`,
    title: `สินค้า ${counter}`,
    imageKey: null,
    priceSatang: 25_900,
    stock: 10,
    visible: true,
    store: STORE_A,
    ...overrides,
  };
}

describe("resolveWriteQuantity (BR-31 (2))", () => {
  it("keeps a quantity within the stock", () => {
    expect(resolveWriteQuantity(3, 3)).toEqual({ quantity: 3, lowered: false });
    expect(resolveWriteQuantity(1, 99)).toEqual({ quantity: 1, lowered: false });
  });

  it("lowers a quantity above a stock of 1 or more to the stock", () => {
    expect(resolveWriteQuantity(5, 3)).toEqual({ quantity: 3, lowered: true });
    expect(resolveWriteQuantity(99, 1)).toEqual({ quantity: 1, lowered: true });
  });

  it("never stores 0: a stock of 0 is a programming error here", () => {
    expect(() => resolveWriteQuantity(1, 0)).toThrow(RangeError);
  });
});

describe("priceLine", () => {
  it("prices a buyable line from the product's price and the stored quantity", () => {
    const input = line({
      storedQuantity: 3,
      priceSatang: 25_900,
      stock: 10,
      imageKey: "a/b c.jpg",
    });
    expect(priceLine(input)).toEqual({
      id: input.id,
      productId: input.productId,
      slug: input.slug,
      title: input.title,
      image: { key: "a/b c.jpg", url: "/api/files/a%2Fb%20c.jpg" },
      unitPriceSatang: 25_900,
      quantity: 3,
      lineTotalSatang: 77_700,
      stock: 10,
      buyable: true,
      unbuyableReason: null,
      quantityLowered: false,
    });
  });

  it("reports a stored quantity above a stock of 1 or more as lowered, priced at the stock (BR-30)", () => {
    const priced = priceLine(line({ storedQuantity: 5, stock: 3, priceSatang: 25_900 }));
    expect(priced).toMatchObject({
      quantity: 3,
      lineTotalSatang: 77_700,
      stock: 3,
      buyable: true,
      quantityLowered: true,
    });
  });

  it("marks a visible product with stock 0 as sold out, not lowered, quantity as stored (BR-38)", () => {
    const priced = priceLine(line({ storedQuantity: 4, stock: 0, priceSatang: 1_000 }));
    expect(priced).toMatchObject({
      quantity: 4,
      unitPriceSatang: 1_000,
      lineTotalSatang: 4_000,
      stock: 0,
      buyable: false,
      unbuyableReason: "SOLD_OUT",
      quantityLowered: false,
    });
  });

  it("marks a hidden product NOT_AVAILABLE with no price, total, or stock, whatever its stock (BR-38)", () => {
    for (const stock of [0, 1, 50]) {
      const priced = priceLine(line({ visible: false, stock, storedQuantity: 7 }));
      expect(priced).toMatchObject({
        quantity: 7,
        unitPriceSatang: null,
        lineTotalSatang: null,
        stock: null,
        buyable: false,
        unbuyableReason: "NOT_AVAILABLE",
        quantityLowered: false,
      });
      // SEC-054: no content of a hidden product is returned.
      expect(priced.title).toBeNull();
      expect(priced.slug).toBeNull();
      expect(priced.image).toBeNull();
    }
  });

  it("returns exactly the id, product id, and quantity of a hidden line, with no product content (SEC-054)", () => {
    const input = line({
      visible: false,
      slug: "unapproved-slug",
      title: "Unapproved title",
      imageKey: "unapproved-key",
      storedQuantity: 3,
    });
    const priced = priceLine(input);
    expect(priced).toEqual({
      id: input.id,
      productId: input.productId,
      slug: null,
      title: null,
      image: null,
      unitPriceSatang: null,
      quantity: 3,
      lineTotalSatang: null,
      stock: null,
      buyable: false,
      unbuyableReason: "NOT_AVAILABLE",
      quantityLowered: false,
    });
    const text = JSON.stringify(priced);
    expect(text).not.toContain("unapproved");
    expect(text).not.toContain("Unapproved");
  });

  it("keeps the slug, title, and picture of a visible sold-out line (SEC-054 is about hidden lines only)", () => {
    const input = line({ stock: 0, imageKey: "sold-out-key" });
    const priced = priceLine(input);
    expect(priced.slug).toBe(input.slug);
    expect(priced.title).toBe(input.title);
    expect(priced.image?.key).toBe("sold-out-key");
  });

  it("handles the largest line without leaving integers: 99 x 100,000,000 satang", () => {
    const priced = priceLine(
      line({ storedQuantity: 99, stock: 1_000_000, priceSatang: 100_000_000 }),
    );
    expect(priced.lineTotalSatang).toBe(9_900_000_000);
    expect(Number.isSafeInteger(priced.lineTotalSatang)).toBe(true);
  });
});

describe("buildCart", () => {
  it("is an empty cart with zero totals and no checkout for no lines", () => {
    expect(buildCart([], 4_000)).toEqual({
      stores: [],
      itemsSubtotalSatang: 0,
      shippingTotalSatang: 0,
      grandTotalSatang: 0,
      canCheckout: false,
    });
  });

  it("groups by store in first-appearance order and charges the flat fee once per store", () => {
    const a1 = line({ store: STORE_A, storedQuantity: 1, priceSatang: 10_000 });
    const b1 = line({ store: STORE_B, storedQuantity: 2, priceSatang: 5_000 });
    const a2 = line({ store: STORE_A, storedQuantity: 3, priceSatang: 1_000 });
    const cart = buildCart([a1, b1, a2], 4_000);
    expect(cart.stores.map((group) => group.store)).toEqual([
      { name: STORE_A.name, slug: STORE_A.slug, isSample: false },
      { name: STORE_B.name, slug: STORE_B.slug, isSample: true },
    ]);
    expect(cart.stores[0]?.items.map((item) => item.id)).toEqual([a1.id, a2.id]);
    expect(cart.stores.map((group) => group.itemsSubtotalSatang)).toEqual([13_000, 10_000]);
    expect(cart.stores.map((group) => group.shippingFeeSatang)).toEqual([4_000, 4_000]);
    expect(cart.stores.every((group) => group.shippingFeeIsSimulated)).toBe(true);
    expect(cart).toMatchObject({
      itemsSubtotalSatang: 23_000,
      shippingTotalSatang: 8_000,
      grandTotalSatang: 31_000,
      canCheckout: true,
    });
  });

  it("never exposes the store id in a group", () => {
    const cart = buildCart([line()], 0);
    expect(Object.keys(cart.stores[0]?.store ?? {}).sort()).toEqual(["isSample", "name", "slug"]);
  });

  it("leaves unbuyable lines out of every total and blocks checkout (BR-22, BR-38)", () => {
    const buyable = line({ store: STORE_A, storedQuantity: 1, priceSatang: 10_000 });
    const soldOut = line({ store: STORE_A, stock: 0, priceSatang: 99_999 });
    const hidden = line({ store: STORE_A, visible: false, priceSatang: 88_888 });
    const cart = buildCart([buyable, soldOut, hidden], 4_000);
    expect(cart.stores[0]?.itemsSubtotalSatang).toBe(10_000);
    expect(cart).toMatchObject({
      itemsSubtotalSatang: 10_000,
      shippingTotalSatang: 4_000,
      grandTotalSatang: 14_000,
      canCheckout: false,
    });
  });

  it("keeps the store name of a group whose only line is hidden, so the line can be recognised (SEC-054)", () => {
    const hidden = line({ store: STORE_B, visible: false, title: "Hidden title" });
    const cart = buildCart([hidden], 4_000);
    expect(cart.stores[0]?.store).toEqual({
      name: STORE_B.name,
      slug: STORE_B.slug,
      isSample: true,
    });
    expect(cart.stores[0]?.items[0]).toMatchObject({
      id: hidden.id,
      title: null,
      slug: null,
      image: null,
    });
    expect(cart.stores[0]?.shippingFeeSatang).toBe(0);
  });

  it("charges no fee for a store whose every line is unbuyable, and the fees add up", () => {
    const onlySoldOut = line({ store: STORE_B, stock: 0 });
    const buyable = line({ store: STORE_A, storedQuantity: 1, priceSatang: 10_000 });
    const cart = buildCart([onlySoldOut, buyable], 4_000);
    expect(cart.stores.map((group) => group.shippingFeeSatang)).toEqual([0, 4_000]);
    expect(cart.stores[0]?.itemsSubtotalSatang).toBe(0);
    const sumOfFees = cart.stores.reduce((sum, group) => sum + group.shippingFeeSatang, 0);
    expect(cart.shippingTotalSatang).toBe(sumOfFees);
    expect(cart.canCheckout).toBe(false);
  });

  it("uses the lowered quantity in every total (BR-30) and still allows checkout", () => {
    const lowered = line({ storedQuantity: 5, stock: 3, priceSatang: 25_900 });
    const cart = buildCart([lowered], 4_000);
    expect(cart).toMatchObject({
      itemsSubtotalSatang: 77_700,
      shippingTotalSatang: 4_000,
      grandTotalSatang: 81_700,
      canCheckout: true,
    });
  });

  it("uses a fee of 0 as given", () => {
    expect(buildCart([line({ storedQuantity: 1, priceSatang: 100 })], 0).grandTotalSatang).toBe(
      100,
    );
  });

  it("refuses a fee or a price that is not a safe non-negative integer (a server fault)", () => {
    expect(() => buildCart([], -1)).toThrow(RangeError);
    expect(() => buildCart([], 1.5)).toThrow(RangeError);
    expect(() => priceLine(line({ priceSatang: 10.5 }))).toThrow(RangeError);
  });
});

describe("assertSatang", () => {
  it("accepts 0 and safe integers, refuses the rest", () => {
    expect(assertSatang(0)).toBe(0);
    expect(assertSatang(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    for (const bad of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => assertSatang(bad)).toThrow(RangeError);
    }
  });
});
