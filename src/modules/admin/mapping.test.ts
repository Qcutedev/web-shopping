/**
 * Unit tests of the admin shapes (docs/API_CONTRACTS.md section 5.9): exactly the documented
 * keys, the paid time only on a paid order (BR-39), a failed order's parts marked as payment
 * failed and a paid cancelled part as refund outside the system (BR-20, BR-21), the store counts
 * with every status present, and the aggregate checks (section 1.5).
 */
import { describe, expect, it } from "vitest";

import {
  toAdminOrderDto,
  toAdminProductDto,
  toAdminSummaryDto,
  toAdminUserDto,
  toAuditLogDto,
  toReportDto,
  toSettingsDto,
} from "./mapping";
import type { AdminOrderRow, ProductRow, UserRow } from "./repository";

const CREATED = new Date("2026-10-11T10:00:00Z");
const PAID = new Date("2026-10-11T18:30:00Z");

function orderRow(
  paymentStatus: AdminOrderRow["paymentStatus"],
  fulfilmentStatus: "PENDING" | "CANCELLED" = "PENDING",
): AdminOrderRow {
  return {
    id: "o1",
    userId: "u1",
    orderNumber: "OD2610110000042",
    createdAt: CREATED,
    paidAt: paymentStatus === "PAID" ? PAID : null,
    paymentStatus,
    itemsSubtotalSatang: 25_900,
    shippingTotalSatang: 4_000,
    grandTotalSatang: 29_900,
    shipRecipientName: "r",
    shipPhone: "0812345678",
    shipLine1: "l",
    shipSubdistrict: "s",
    shipDistrict: "d",
    shipProvince: "p",
    shipPostalCode: "10110",
    payment: { provider: "MOCK", failureReason: paymentStatus === "FAILED" ? "TIMEOUT" : null },
    sellerOrders: [
      {
        id: "so1",
        storeId: "store1",
        storeName: "ร้านเดิม",
        store: { slug: "shop-abcdefgh" },
        fulfilmentStatus,
        itemsSubtotalSatang: 25_900,
        shippingFeeSatang: 4_000,
        shippingFeeIsSimulated: true,
        commissionRateBps: 500,
        shipment: null,
        items: [],
      },
    ],
  };
}

describe("toAdminOrderDto", () => {
  it("is the customer's shape plus userId, storeId, and commissionRateBps", () => {
    const dto = toAdminOrderDto(orderRow("PAID"));
    expect(dto.userId).toBe("u1");
    expect(dto.paidAt).toBe("2026-10-11T18:30:00.000Z");
    expect(dto.payment).toEqual({ provider: "MOCK", isSimulated: true, failureReason: null });
    expect(dto.sellerOrders[0]).toMatchObject({
      id: "so1",
      storeId: "store1",
      commissionRateBps: 500,
      storeName: "ร้านเดิม",
      shippingFeeIsSimulated: true,
      cancellationKind: null,
    });
  });

  it("shows no paid time for a PENDING or FAILED order (BR-39)", () => {
    expect(toAdminOrderDto(orderRow("PENDING")).paidAt).toBeNull();
    expect(toAdminOrderDto(orderRow("FAILED", "CANCELLED")).paidAt).toBeNull();
  });

  it("marks a failed order's part as payment failed, a paid cancelled part as refund outside the system", () => {
    expect(toAdminOrderDto(orderRow("FAILED", "CANCELLED")).sellerOrders[0]?.cancellationKind).toBe(
      "PAYMENT_FAILED",
    );
    expect(toAdminOrderDto(orderRow("PAID", "CANCELLED")).sellerOrders[0]?.cancellationKind).toBe(
      "REFUND_OUTSIDE_SYSTEM",
    );
    expect(
      toAdminOrderDto(orderRow("PENDING", "CANCELLED")).sellerOrders[0]?.cancellationKind,
    ).toBe("BEFORE_PAYMENT");
  });
});

describe("toAdminUserDto", () => {
  it("has exactly the documented keys", () => {
    const row = {
      id: "u1",
      name: "n",
      email: "e@example.com",
      phone: null,
      role: "SELLER",
      isActive: true,
      createdAt: CREATED,
      store: { id: "s", name: "S", slug: "s-abcdefgh", status: "SUSPENDED" },
      // A wider row never leaks: the mapping copies keys one by one.
      passwordHash: "secret",
    } as unknown as UserRow;
    const dto = toAdminUserDto(row);
    expect(Object.keys(dto).sort()).toEqual(
      ["createdAt", "email", "id", "isActive", "name", "phone", "role", "store"].sort(),
    );
    expect(JSON.stringify(dto)).not.toContain("secret");
  });
});

describe("toAdminProductDto", () => {
  it("is the seller's view plus contentRevision, moderationRequestedAt, and the store", () => {
    const row: ProductRow = {
      id: "p1",
      storeId: "s1",
      slug: "p-abcdefgh",
      title: "t",
      description: "d",
      sku: "k",
      categoryId: "c1",
      priceSatang: 25_900,
      stock: 3,
      status: "PUBLISHED",
      moderationStatus: "APPROVED",
      moderationNote: null,
      moderationRequestedAt: CREATED,
      contentRevision: 7,
      isSample: false,
      createdAt: CREATED,
      updatedAt: CREATED,
      category: { id: "c1", name: "C", isActive: false },
      store: { id: "s1", name: "S", slug: "s-abcdefgh", status: "APPROVED" },
      imageKeys: ["k1"],
    };
    const dto = toAdminProductDto(row);
    expect(dto).toMatchObject({
      contentRevision: 7,
      moderationRequestedAt: CREATED.toISOString(),
      lowStock: true,
      soldOut: false,
      store: { id: "s1", status: "APPROVED" },
      images: [{ key: "k1", url: "/api/files/k1" }],
    });
    expect(dto).not.toHaveProperty("storeId");
    expect(dto).not.toHaveProperty("categoryId");
  });
});

describe("toAdminSummaryDto and toReportDto", () => {
  it("every store status is present; the aggregate is a checked number", () => {
    expect(
      toAdminSummaryDto({
        pendingApplicationCount: 3,
        pendingProductCount: 11,
        userCount: 240,
        storesByStatus: [{ status: "APPROVED", count: 18 }],
        orderCount: 420,
        paidRevenue: "31200000",
      }),
    ).toEqual({
      pendingApplicationCount: 3,
      pendingProductCount: 11,
      userCount: 240,
      storesByStatus: { APPROVED: 18, SUSPENDED: 0 },
      orderCount: 420,
      paidRevenueSatang: 31_200_000,
    });
  });

  it("an aggregate above 32 bits is sent exactly; above 2^53 - 1 is a fault, never rounded", () => {
    const rows = { orderCount: 2, paidRevenue: "4000000000", newUserCount: 1, newSellerCount: 0 };
    const from = new Date("2026-10-10T17:00:00Z");
    const to = new Date("2026-10-11T17:00:00Z");
    expect(toReportDto(from, to, rows)).toEqual({
      from: "2026-10-10T17:00:00.000Z",
      to: "2026-10-11T17:00:00.000Z",
      orderCount: 2,
      paidRevenueSatang: 4_000_000_000,
      newUserCount: 1,
      newSellerCount: 0,
    });
    expect(() => toReportDto(from, to, { ...rows, paidRevenue: "9007199254740992" })).toThrow();
  });

  it("an unknown store status is a fault", () => {
    expect(() =>
      toAdminSummaryDto({
        pendingApplicationCount: 0,
        pendingProductCount: 0,
        userCount: 0,
        storesByStatus: [{ status: "PENDING", count: 1 }],
        orderCount: 0,
        paidRevenue: "0",
      }),
    ).toThrow();
  });
});

describe("toSettingsDto and toAuditLogDto", () => {
  it("map the documented keys", () => {
    expect(
      toSettingsDto({
        flatShippingFeeSatang: 4_000,
        commissionRateBps: 500,
        updatedAt: CREATED,
        updatedById: null,
      }),
    ).toEqual({
      flatShippingFeeSatang: 4_000,
      commissionRateBps: 500,
      updatedAt: CREATED.toISOString(),
      updatedById: null,
    });
    expect(
      toAuditLogDto({
        id: "a1",
        actorId: "u1",
        action: "STORE_SUSPENDED",
        targetType: "Store",
        targetId: "s1",
        metadata: { reason: "r", before: { status: "APPROVED" }, after: { status: "SUSPENDED" } },
        createdAt: CREATED,
      }),
    ).toEqual({
      id: "a1",
      actorId: "u1",
      action: "STORE_SUSPENDED",
      targetType: "Store",
      targetId: "s1",
      metadata: { reason: "r", before: { status: "APPROVED" }, after: { status: "SUSPENDED" } },
      createdAt: CREATED.toISOString(),
    });
  });
});
