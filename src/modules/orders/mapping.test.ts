import { describe, expect, it } from "vitest";

import {
  MAX_CART_LINE_QUANTITY,
  type OrderItemRow,
  type OrderRow,
  returnedLineQuantity,
  type SellerOrderRow,
  toCartReturn,
  toOrderDto,
} from "./mapping";

describe("returnedLineQuantity (BR-32; DATA_MODEL 7.2 step 5)", () => {
  it("with no line, the item returns whole", () => {
    expect(returnedLineQuantity(0, 3, 3)).toBe(3);
    expect(returnedLineQuantity(0, 3, 500)).toBe(3);
  });

  it("adds the quantities together, capped at 99 (the REQ-C-12 example: 60 + 50, stock 200)", () => {
    expect(returnedLineQuantity(60, 50, 200)).toBe(MAX_CART_LINE_QUANTITY);
  });

  it("caps at the stock after the restore", () => {
    expect(returnedLineQuantity(4, 3, 5)).toBe(5);
  });

  it("an existing line above the stock ends at the stock, lower than it was", () => {
    expect(returnedLineQuantity(10, 2, 6)).toBe(6);
  });

  it("is never below 1, because the restore added the item's quantity to the stock", () => {
    for (const existing of [0, 1, 50, 99]) {
      for (const ordered of [1, 2, 99]) {
        expect(returnedLineQuantity(existing, ordered, ordered)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("refuses inputs no real item can have", () => {
    expect(() => returnedLineQuantity(0, 0, 5)).toThrow(RangeError);
    expect(() => returnedLineQuantity(0, 3, 2)).toThrow(RangeError);
    expect(() => returnedLineQuantity(-1, 3, 5)).toThrow(RangeError);
    expect(() => returnedLineQuantity(0, 1.5, 5)).toThrow(RangeError);
  });
});

function item(overrides: Partial<OrderItemRow> = {}): OrderItemRow {
  return {
    id: "item_1",
    productId: "product_1",
    productTitle: "สินค้า",
    productSku: "SKU-1",
    productImageUpload: { storageKey: "k/1.webp" },
    unitPriceSatang: 25_900,
    quantity: 3,
    lineTotalSatang: 77_700,
    cartQuantityBeforeReturn: null,
    cartQuantityAfterReturn: null,
    review: null,
    ...overrides,
  };
}

function sellerOrder(overrides: Partial<SellerOrderRow> = {}): SellerOrderRow {
  return {
    id: "so_1",
    storeName: "ชื่อร้านตอนซื้อ",
    store: { slug: "store-abc" },
    fulfilmentStatus: "PENDING",
    itemsSubtotalSatang: 77_700,
    shippingFeeSatang: 4_000,
    shippingFeeIsSimulated: true,
    shipment: null,
    items: [item()],
    ...overrides,
  };
}

function order(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: "order_1",
    orderNumber: "OD2610140000001",
    createdAt: new Date("2026-10-14T03:20:00.000Z"),
    paidAt: new Date("2026-10-14T03:20:01.000Z"),
    paymentStatus: "PAID",
    itemsSubtotalSatang: 77_700,
    shippingTotalSatang: 4_000,
    grandTotalSatang: 81_700,
    shipRecipientName: "สมชาย",
    shipPhone: "0812345678",
    shipLine1: "1 ถนน",
    shipSubdistrict: "แขวง",
    shipDistrict: "เขต",
    shipProvince: "กรุงเทพมหานคร",
    shipPostalCode: "10110",
    payment: { provider: "MOCK", failureReason: null },
    sellerOrders: [sellerOrder()],
    ...overrides,
  };
}

describe("toOrderDto (API_CONTRACTS 5.5.2)", () => {
  it("maps a paid order: copies, mock payment marked simulated, paid time, no cartReturn", () => {
    expect(toOrderDto(order())).toEqual({
      id: "order_1",
      orderNumber: "OD2610140000001",
      createdAt: "2026-10-14T03:20:00.000Z",
      paidAt: "2026-10-14T03:20:01.000Z",
      paymentStatus: "PAID",
      payment: { provider: "MOCK", isSimulated: true, failureReason: null },
      itemsSubtotalSatang: 77_700,
      shippingTotalSatang: 4_000,
      grandTotalSatang: 81_700,
      shippingAddress: {
        recipientName: "สมชาย",
        phone: "0812345678",
        line1: "1 ถนน",
        subdistrict: "แขวง",
        district: "เขต",
        province: "กรุงเทพมหานคร",
        postalCode: "10110",
      },
      sellerOrders: [
        {
          id: "so_1",
          storeName: "ชื่อร้านตอนซื้อ",
          storeSlug: "store-abc",
          fulfilmentStatus: "PENDING",
          cancellationKind: null,
          itemsSubtotalSatang: 77_700,
          shippingFeeSatang: 4_000,
          shippingFeeIsSimulated: true,
          shipment: null,
          items: [
            {
              id: "item_1",
              productId: "product_1",
              productTitle: "สินค้า",
              productSku: "SKU-1",
              image: { key: "k/1.webp", url: "/api/files/k%2F1.webp" },
              unitPriceSatang: 25_900,
              quantity: 3,
              lineTotalSatang: 77_700,
              review: null,
            },
          ],
        },
      ],
      cartReturn: null,
    });
  });

  it("never carries the commission rate (BR-13) or a live product value", () => {
    const text = JSON.stringify(toOrderDto(order()));
    expect(text).not.toContain("commission");
    expect(text).not.toContain("stock");
  });

  it("shows no paid time for an order that is not PAID (BR-39)", () => {
    for (const paymentStatus of ["PENDING", "FAILED"] as const) {
      expect(toOrderDto(order({ paymentStatus, paidAt: null })).paidAt).toBeNull();
    }
  });

  it("a cancelled part of a paid order is REFUND_OUTSIDE_SYSTEM (BR-21)", () => {
    const dto = toOrderDto(
      order({ sellerOrders: [sellerOrder({ fulfilmentStatus: "CANCELLED" })] }),
    );
    expect(dto.sellerOrders[0]?.cancellationKind).toBe("REFUND_OUTSIDE_SYSTEM");
  });

  it("maps a shipment and a review, times in UTC", () => {
    const dto = toOrderDto(
      order({
        sellerOrders: [
          sellerOrder({
            fulfilmentStatus: "DELIVERED",
            shipment: {
              carrierName: null,
              trackingNumber: "TH123",
              isSimulated: true,
              shippedAt: new Date("2026-10-15T01:00:00Z"),
              deliveredAt: new Date("2026-10-16T01:00:00Z"),
            },
            items: [
              item({
                productImageUpload: null,
                review: {
                  id: "r1",
                  rating: 5,
                  comment: null,
                  createdAt: new Date("2026-10-17T00:00:00Z"),
                },
              }),
            ],
          }),
        ],
      }),
    );
    const part = dto.sellerOrders[0];
    expect(part?.shipment).toEqual({
      carrierName: null,
      trackingNumber: "TH123",
      isSimulated: true,
      shippedAt: "2026-10-15T01:00:00.000Z",
      deliveredAt: "2026-10-16T01:00:00.000Z",
    });
    expect(part?.items[0]?.image).toBeNull();
    expect(part?.items[0]?.review).toEqual({
      id: "r1",
      rating: 5,
      comment: null,
      createdAt: "2026-10-17T00:00:00.000Z",
    });
  });

  it("refuses an order without its payment row: a server fault", () => {
    expect(() => toOrderDto(order({ payment: null }))).toThrow();
  });
});

describe("a failed order (API_CONTRACTS 5.5.4)", () => {
  const failed = order({
    paymentStatus: "FAILED",
    paidAt: null,
    payment: { provider: "MOCK", failureReason: "SIMULATED_DECLINE" },
    sellerOrders: [
      sellerOrder({
        fulfilmentStatus: "CANCELLED",
        items: [
          item({
            productId: "a",
            quantity: 3,
            cartQuantityBeforeReturn: 1,
            cartQuantityAfterReturn: 4,
          }),
          item({
            id: "i2",
            productId: "b",
            quantity: 50,
            cartQuantityBeforeReturn: 60,
            cartQuantityAfterReturn: 99,
          }),
        ],
      }),
      // A part an admin cancelled before the failure: its items were not returned.
      sellerOrder({
        id: "so_2",
        fulfilmentStatus: "CANCELLED",
        items: [item({ id: "i3", productId: "c" })],
      }),
    ],
  });

  it("is marked failed with the reason, every part PAYMENT_FAILED, and no paid time", () => {
    const dto = toOrderDto(failed);
    expect(dto.paymentStatus).toBe("FAILED");
    expect(dto.paidAt).toBeNull();
    expect(dto.payment).toEqual({
      provider: "MOCK",
      isSimulated: true,
      failureReason: "SIMULATED_DECLINE",
    });
    expect(dto.sellerOrders.map((part) => part.cancellationKind)).toEqual([
      "PAYMENT_FAILED",
      "PAYMENT_FAILED",
    ]);
  });

  it("cartReturn is read from the stored record; items not returned have no entry", () => {
    expect(toCartReturn(failed)).toEqual({
      capped: true,
      items: [
        { productId: "a", orderedQuantity: 3, cartQuantity: 4, capped: false },
        { productId: "b", orderedQuantity: 50, cartQuantity: 99, capped: true },
      ],
    });
  });

  it("an unknown stored failure reason is not passed on", () => {
    const dto = toOrderDto({
      ...failed,
      payment: { provider: "MOCK", failureReason: "Sneaky text" },
    });
    expect(dto.payment.failureReason).toBeNull();
  });

  it("cartReturn is null on an order whose payment did not fail", () => {
    expect(toCartReturn(order())).toBeNull();
    expect(toCartReturn(order({ paymentStatus: "PENDING", paidAt: null }))).toBeNull();
  });
});
