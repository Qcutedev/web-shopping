import { describe, expect, it } from "vitest";

import {
  type ClassifiedLineRow,
  priceOrder,
  type PurchasedLine,
  refusalCode,
  refusalReason,
  refusalTotals,
  refusedItems,
} from "./pricing";
import { MAX_ORDER_TOTAL_SATANG } from "./schema";

function line(overrides: Partial<PurchasedLine> = {}): PurchasedLine {
  return {
    productId: "p1",
    quantity: 1,
    unitPriceSatang: 25_900,
    title: "สินค้า",
    sku: "SKU-1",
    storeId: "s1",
    storeName: "ร้านหนึ่ง",
    ...overrides,
  };
}

describe("priceOrder (BR-04, BR-07, BR-08, BR-13)", () => {
  it("splits the lines into one seller order per store and computes every amount", () => {
    const priced = priceOrder(
      [
        line({ productId: "a", quantity: 3, unitPriceSatang: 25_900, storeId: "s1" }),
        line({
          productId: "b",
          quantity: 1,
          unitPriceSatang: 10_000,
          storeId: "s2",
          storeName: "ร้านสอง",
        }),
        line({ productId: "c", quantity: 2, unitPriceSatang: 150, storeId: "s1" }),
      ],
      4_000,
      500,
    );
    expect(priced.sellerOrders.map((group) => group.storeId)).toEqual(["s1", "s2"]);
    const [first, second] = priced.sellerOrders;
    expect(first?.items.map((item) => item.lineTotalSatang)).toEqual([77_700, 300]);
    expect(first?.itemsSubtotalSatang).toBe(78_000);
    expect(second?.itemsSubtotalSatang).toBe(10_000);
    expect(second?.storeName).toBe("ร้านสอง");
    for (const group of priced.sellerOrders) {
      expect(group.shippingFeeSatang).toBe(4_000);
      expect(group.commissionRateBps).toBe(500);
    }
    expect(priced.itemsSubtotalSatang).toBe(88_000);
    expect(priced.shippingTotalSatang).toBe(8_000);
    expect(priced.grandTotalSatang).toBe(96_000);
    expect(priced.withinLimit).toBe(true);
  });

  it("the commission is recorded only: no amount is reduced by it (BR-13)", () => {
    const without = priceOrder([line()], 4_000, 0);
    const withRate = priceOrder([line()], 4_000, 10_000);
    expect(withRate.grandTotalSatang).toBe(without.grandTotalSatang);
  });

  it("a grand total of exactly 2,000,000,000 is allowed; one satang more is not (BR-04)", () => {
    const exact = priceOrder([line({ unitPriceSatang: 100_000_000, quantity: 20 })], 0, 0);
    expect(exact.grandTotalSatang).toBe(MAX_ORDER_TOTAL_SATANG);
    expect(exact.withinLimit).toBe(true);
    const over = priceOrder([line({ unitPriceSatang: 100_000_000, quantity: 20 })], 1, 0);
    expect(over.grandTotalSatang).toBe(MAX_ORDER_TOTAL_SATANG + 1);
    expect(over.withinLimit).toBe(false);
  });

  it("a total that would not fit a 32-bit column is computed exactly and refused (T-031 review)", () => {
    const lines = Array.from({ length: 3 }, (_, index) =>
      line({ productId: `p${index}`, unitPriceSatang: 100_000_000, quantity: 99 }),
    );
    const priced = priceOrder(lines, 100_000, 0);
    expect(priced.grandTotalSatang).toBe(29_700_000_000 + 100_000);
    expect(priced.withinLimit).toBe(false);
  });

  it("the shipping fee may be 0, and is charged once per seller order", () => {
    const priced = priceOrder(
      [line({ storeId: "a" }), line({ storeId: "b", productId: "p2" })],
      0,
      500,
    );
    expect(priced.shippingTotalSatang).toBe(0);
  });

  it("refuses amounts that are not safe non-negative integers: a server fault, never rounded", () => {
    expect(() => priceOrder([line({ unitPriceSatang: 1.5 })], 0, 0)).toThrow(RangeError);
    expect(() => priceOrder([line({ quantity: 0 })], 0, 0)).toThrow(RangeError);
    expect(() => priceOrder([line()], -1, 0)).toThrow(RangeError);
    expect(() => priceOrder([line()], 0, -1)).toThrow(RangeError);
  });
});

function classified(overrides: Partial<ClassifiedLineRow> = {}): ClassifiedLineRow {
  return {
    cartItemId: "line_1",
    productId: "p1",
    quantity: 2,
    stock: 10,
    priceSatang: 1_000,
    slug: "p1",
    title: "สินค้า",
    storeId: "s1",
    storeName: "ร้าน",
    storeSlug: "s1",
    storeIsSample: false,
    visible: true,
    ownStore: false,
    ...overrides,
  };
}

describe("refusalReason (BR-16, BR-22, BR-38)", () => {
  it("a hidden product is NOT_AVAILABLE whatever its stock or store, never sold out", () => {
    expect(refusalReason(classified({ visible: false, stock: 0 }))).toBe("NOT_AVAILABLE");
    expect(refusalReason(classified({ visible: false, ownStore: true }))).toBe("NOT_AVAILABLE");
  });

  it("the caller's own store is OWN_STORE, before the stock", () => {
    expect(refusalReason(classified({ ownStore: true, stock: 0 }))).toBe("OWN_STORE");
  });

  it("a stock below the quantity is INSUFFICIENT_STOCK, a stock equal to it is buyable", () => {
    expect(refusalReason(classified({ quantity: 3, stock: 2 }))).toBe("INSUFFICIENT_STOCK");
    expect(refusalReason(classified({ quantity: 3, stock: 0 }))).toBe("INSUFFICIENT_STOCK");
    expect(refusalReason(classified({ quantity: 3, stock: 3 }))).toBeNull();
  });
});

describe("refusedItems and refusalCode (API_CONTRACTS 5.5.3)", () => {
  const lines = [
    classified({ cartItemId: "ok", productId: "a" }),
    classified({ cartItemId: "hidden", productId: "b", visible: false, quantity: 1 }),
    classified({ cartItemId: "low", productId: "c", quantity: 5, stock: 3 }),
    classified({ cartItemId: "soldout", productId: "d", quantity: 1, stock: 0 }),
    classified({ cartItemId: "own", productId: "e", ownStore: true, quantity: 4 }),
  ];

  /** The read after the lowering: the lowered lines hold their new quantity. */
  function afterLowering(
    rows: readonly ClassifiedLineRow[],
    lowered: ReadonlyMap<string, number>,
  ): ClassifiedLineRow[] {
    return rows.map((row) => ({ ...row, quantity: lowered.get(row.cartItemId) ?? row.quantity }));
  }

  it("names every line that cannot be bought, in cart order, with the stored new quantity", () => {
    const lowered = new Map([["low", 3]]);
    const items = refusedItems(lines, lowered, afterLowering(lines, lowered));
    expect(items).toEqual([
      {
        cartItemId: "hidden",
        productId: "b",
        reason: "NOT_AVAILABLE",
        requestedQuantity: 1,
        availableStock: null,
      },
      {
        cartItemId: "low",
        productId: "c",
        reason: "INSUFFICIENT_STOCK",
        requestedQuantity: 5,
        availableStock: 3,
      },
      {
        cartItemId: "soldout",
        productId: "d",
        reason: "INSUFFICIENT_STOCK",
        requestedQuantity: 1,
        availableStock: 0,
      },
      {
        cartItemId: "own",
        productId: "e",
        reason: "OWN_STORE",
        requestedQuantity: 4,
        availableStock: null,
      },
    ]);
    expect(refusalCode(items)).toBe("PRODUCT_UNAVAILABLE");
  });

  it("is INSUFFICIENT_STOCK only when every listed line fails on stock", () => {
    const rows = [lines[2], lines[3]] as ClassifiedLineRow[];
    const lowered = new Map([["low", 3]]);
    const items = refusedItems(rows, lowered, afterLowering(rows, lowered));
    expect(refusalCode(items)).toBe("INSUFFICIENT_STOCK");
  });

  describe("a race between the first read and the lowering (CR-T032-07)", () => {
    it("a line the first read found buyable but the lowering changed is listed, with the stored quantity", () => {
      // First read: stock 10 for 2. Then stock fell to 1, and the lowering stored 1.
      const before = [classified({ cartItemId: "x", productId: "x", quantity: 2, stock: 10 })];
      const after = [classified({ cartItemId: "x", productId: "x", quantity: 1, stock: 1 })];
      expect(refusedItems(before, new Map([["x", 1]]), after)).toEqual([
        {
          cartItemId: "x",
          productId: "x",
          reason: "INSUFFICIENT_STOCK",
          requestedQuantity: 2,
          availableStock: 1,
        },
      ]);
    });

    it("a line the first read refused but that sold out before the lowering says 0, not the old stock", () => {
      const before = [classified({ cartItemId: "y", productId: "y", quantity: 5, stock: 3 })];
      const after = [classified({ cartItemId: "y", productId: "y", quantity: 5, stock: 0 })];
      expect(refusedItems(before, new Map(), after)).toEqual([
        {
          cartItemId: "y",
          productId: "y",
          reason: "INSUFFICIENT_STOCK",
          requestedQuantity: 5,
          availableStock: 0,
        },
      ]);
    });

    it("a lowered line whose product was hidden before the read after is NOT_AVAILABLE", () => {
      const before = [classified({ cartItemId: "z", productId: "z", quantity: 5, stock: 3 })];
      const after = [
        classified({ cartItemId: "z", productId: "z", quantity: 3, stock: 3, visible: false }),
      ];
      expect(refusedItems(before, new Map([["z", 3]]), after)).toEqual([
        {
          cartItemId: "z",
          productId: "z",
          reason: "NOT_AVAILABLE",
          requestedQuantity: 5,
          availableStock: null,
        },
      ]);
    });

    it("a line refused at first but buyable after, and not lowered, is not listed", () => {
      const before = [classified({ cartItemId: "w", productId: "w", quantity: 5, stock: 3 })];
      const after = [classified({ cartItemId: "w", productId: "w", quantity: 5, stock: 9 })];
      expect(refusedItems(before, new Map(), after)).toEqual([]);
    });
  });
});

describe("refusalTotals: what GET /cart returns after the refusal", () => {
  it("counts the lowered quantity and leaves out hidden and sold-out lines", () => {
    const lines = [
      classified({
        cartItemId: "ok",
        productId: "a",
        quantity: 2,
        priceSatang: 1_000,
        storeId: "s1",
      }),
      // As the read after the lowering finds it: 5 lowered to the stock of 3.
      classified({
        cartItemId: "low",
        productId: "c",
        quantity: 3,
        stock: 3,
        priceSatang: 500,
        storeId: "s2",
      }),
      classified({ cartItemId: "hidden", productId: "b", visible: false, storeId: "s3" }),
      classified({ cartItemId: "soldout", productId: "d", stock: 0, storeId: "s4" }),
    ];
    expect(refusalTotals(lines, 4_000)).toEqual({
      itemsSubtotalSatang: 2_000 + 1_500,
      shippingTotalSatang: 8_000,
      grandTotalSatang: 11_500,
    });
  });
});
