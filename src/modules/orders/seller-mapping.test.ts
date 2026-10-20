/**
 * Unit tests of the seller shapes (docs/API_CONTRACTS.md sections 1.5, 3.2, 5.7.3, and 5.7.4): a
 * seller order carries exactly the keys of the contract, the copies taken at purchase, the paid
 * time of the whole order (BR-39), and `REFUND_OUTSIDE_SYSTEM` once cancelled (BR-21); the
 * summary has every status, and its aggregate is sent only as a safe integer.
 */
import { describe, expect, it } from "vitest";

import {
  aggregateSatang,
  toSellerOrderListItemDto,
  toSellerOrderViewDto,
  toSellerSummaryDto,
} from "./seller-mapping";
import type { SellerOrderListRow, SellerOrderViewRow } from "./seller-repository";

const ROW: SellerOrderViewRow = {
  id: "so1",
  storeName: "ร้านเดิม",
  fulfilmentStatus: "PENDING",
  itemsSubtotalSatang: 77_700,
  shippingFeeSatang: 4_000,
  shippingFeeIsSimulated: true,
  commissionRateBps: 500,
  order: {
    orderNumber: "OD2610110000042",
    createdAt: new Date("2026-10-11T18:29:00.000Z"),
    paidAt: new Date("2026-10-11T18:30:00.000Z"),
    paymentStatus: "PAID",
    shipRecipientName: "สมชาย",
    shipPhone: "0812345678",
    shipLine1: "1 ถนน",
    shipSubdistrict: "แขวง",
    shipDistrict: "เขต",
    shipProvince: "กรุงเทพมหานคร",
    shipPostalCode: "10110",
  },
  shipment: null,
  items: [
    {
      id: "i1",
      productId: "p1",
      productTitle: "เสื้อ",
      productSku: "S1",
      imageKey: "0123456789abcdef0123456789abcdef",
      unitPriceSatang: 25_900,
      quantity: 3,
      lineTotalSatang: 77_700,
    },
    {
      id: "i2",
      productId: "p2",
      productTitle: "กางเกง",
      productSku: "S2",
      imageKey: null,
      unitPriceSatang: 100,
      quantity: 1,
      lineTotalSatang: 100,
    },
  ],
};

describe("toSellerOrderViewDto", () => {
  it("has exactly the contract's keys, with copies taken at purchase and the paid time", () => {
    const dto = toSellerOrderViewDto(ROW);
    expect(Object.keys(dto).sort()).toEqual(
      [
        "cancellationKind",
        "commissionRateBps",
        "createdAt",
        "fulfilmentStatus",
        "id",
        "items",
        "itemsSubtotalSatang",
        "orderNumber",
        "paidAt",
        "paymentStatus",
        "shipment",
        "shippingAddress",
        "shippingFeeIsSimulated",
        "shippingFeeSatang",
        "storeName",
      ].sort(),
    );
    expect(dto).toMatchObject({
      id: "so1",
      orderNumber: "OD2610110000042",
      createdAt: "2026-10-11T18:29:00.000Z",
      paidAt: "2026-10-11T18:30:00.000Z",
      paymentStatus: "PAID",
      fulfilmentStatus: "PENDING",
      cancellationKind: null,
      storeName: "ร้านเดิม",
      itemsSubtotalSatang: 77_700,
      shippingFeeSatang: 4_000,
      shippingFeeIsSimulated: true,
      commissionRateBps: 500,
      shippingAddress: {
        recipientName: "สมชาย",
        phone: "0812345678",
        line1: "1 ถนน",
        subdistrict: "แขวง",
        district: "เขต",
        province: "กรุงเทพมหานคร",
        postalCode: "10110",
      },
      shipment: null,
    });
    expect(dto.items).toEqual([
      {
        id: "i1",
        productId: "p1",
        productTitle: "เสื้อ",
        productSku: "S1",
        image: {
          key: "0123456789abcdef0123456789abcdef",
          url: "/api/files/0123456789abcdef0123456789abcdef",
        },
        unitPriceSatang: 25_900,
        quantity: 3,
        lineTotalSatang: 77_700,
      },
      {
        id: "i2",
        productId: "p2",
        productTitle: "กางเกง",
        productSku: "S2",
        image: null,
        unitPriceSatang: 100,
        quantity: 1,
        lineTotalSatang: 100,
      },
    ]);
    expect(JSON.stringify(dto)).not.toMatch(/grandTotal|storeId|userId|ownerId/);
  });

  it("a cancelled seller order of a paid order is REFUND_OUTSIDE_SYSTEM and keeps its paid time", () => {
    const dto = toSellerOrderViewDto({ ...ROW, fulfilmentStatus: "CANCELLED" });
    expect(dto.cancellationKind).toBe("REFUND_OUTSIDE_SYSTEM");
    expect(dto.paymentStatus).toBe("PAID");
    expect(dto.paidAt).toBe("2026-10-11T18:30:00.000Z");
  });

  it("maps the shipment, simulated, with a null delivery time until delivered", () => {
    const shipped = toSellerOrderViewDto({
      ...ROW,
      fulfilmentStatus: "SHIPPED",
      shipment: {
        carrierName: null,
        trackingNumber: "T1",
        isSimulated: true,
        shippedAt: new Date("2026-10-12T00:00:00.000Z"),
        deliveredAt: null,
      },
    });
    expect(shipped.shipment).toEqual({
      carrierName: null,
      trackingNumber: "T1",
      isSimulated: true,
      shippedAt: "2026-10-12T00:00:00.000Z",
      deliveredAt: null,
    });
  });

  it.each([
    ["PENDING", null],
    ["FAILED", null],
    ["PAID", null],
  ] as const)(
    "refuses an order whose payment is %s with paidAt %s (a fault, never a shape)",
    (status, paidAt) => {
      expect(() =>
        toSellerOrderViewDto({ ...ROW, order: { ...ROW.order, paymentStatus: status, paidAt } }),
      ).toThrow(Error);
    },
  );
});

const LIST_KEYS = [
  "cancellationKind",
  "commissionRateBps",
  "createdAt",
  "fulfilmentStatus",
  "id",
  "items",
  "itemsSubtotalSatang",
  "orderNumber",
  "paymentStatus",
  "shipment",
  "shippingFeeIsSimulated",
  "shippingFeeSatang",
  "storeName",
].sort();

describe("toSellerOrderListItemDto (owner ruling on Q42: no paidAt, no address)", () => {
  const LIST_ROW: SellerOrderListRow = {
    ...ROW,
    order: {
      orderNumber: ROW.order.orderNumber,
      createdAt: ROW.order.createdAt,
      paymentStatus: ROW.order.paymentStatus,
    },
  };

  it("has exactly the list keys: neither paidAt nor shippingAddress", () => {
    const dto = toSellerOrderListItemDto(LIST_ROW);
    expect(Object.keys(dto).sort()).toEqual(LIST_KEYS);
    expect(dto).toMatchObject({
      id: "so1",
      orderNumber: "OD2610110000042",
      createdAt: "2026-10-11T18:29:00.000Z",
      paymentStatus: "PAID",
      cancellationKind: null,
    });
    expect(dto.items).toEqual(toSellerOrderViewDto(ROW).items);
  });

  it("never copies the paid time or an address field from a wider row", () => {
    // A detail row passed by mistake still yields only the list keys.
    const dto = toSellerOrderListItemDto(ROW);
    expect(Object.keys(dto).sort()).toEqual(LIST_KEYS);
    const text = JSON.stringify(dto);
    // The postal code "10110" is not checked by value: it also occurs inside the order number.
    for (const value of ["2026-10-11T18:30:00.000Z", "สมชาย", "0812345678", "1 ถนน", "แขวง"]) {
      expect(text).not.toContain(value);
    }
    expect(text).not.toMatch(/paidAt|shippingAddress|postalCode|recipientName|phone/);
  });

  it("the detail is the list entry plus paidAt and shippingAddress", () => {
    const list = toSellerOrderListItemDto(ROW);
    const { paidAt, shippingAddress, ...rest } = toSellerOrderViewDto(ROW);
    expect(rest).toEqual(list);
    expect(paidAt).toBe("2026-10-11T18:30:00.000Z");
    expect(shippingAddress.postalCode).toBe("10110");
  });

  it.each(["PENDING", "FAILED"] as const)(
    "refuses an order whose payment is %s (a fault, never a shape)",
    (status) => {
      expect(() =>
        toSellerOrderListItemDto({
          ...LIST_ROW,
          order: { ...LIST_ROW.order, paymentStatus: status },
        }),
      ).toThrow(Error);
    },
  );
});

describe("aggregateSatang", () => {
  it("passes a sum above 32 bits exactly", () => {
    expect(aggregateSatang("0")).toBe(0);
    expect(aggregateSatang("4000000000")).toBe(4_000_000_000);
    expect(aggregateSatang(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("refuses a sum that is not a safe non-negative integer", () => {
    for (const text of ["9007199254740992", "-1", "1.5", "", "01", "1e3"]) {
      expect(() => aggregateSatang(text)).toThrow(RangeError);
    }
  });
});

describe("toSellerSummaryDto", () => {
  it("fills every status with 0 and passes the counts and the total", () => {
    expect(
      toSellerSummaryDto({
        productsByStatus: [{ status: "PUBLISHED", count: 14 }],
        lowStockCount: 3,
        soldOutCount: 1,
        ordersByStatus: [
          { status: "DELIVERED", count: 9 },
          { status: "CANCELLED", count: 1 },
        ],
        paidSalesTotal: "1250000",
      }),
    ).toEqual({
      productsByStatus: { DRAFT: 0, PUBLISHED: 14, ARCHIVED: 0 },
      lowStockCount: 3,
      soldOutCount: 1,
      ordersByStatus: { PENDING: 0, PROCESSING: 0, SHIPPED: 0, DELIVERED: 9, CANCELLED: 1 },
      paidSalesTotalSatang: 1_250_000,
    });
  });

  it("refuses a status outside the known values", () => {
    expect(() =>
      toSellerSummaryDto({
        productsByStatus: [{ status: "DELETED", count: 1 }],
        lowStockCount: 0,
        soldOutCount: 0,
        ordersByStatus: [],
        paidSalesTotal: "0",
      }),
    ).toThrow(Error);
  });
});
