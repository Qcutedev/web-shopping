/**
 * Unit tests of the seller order schemas (docs/API_CONTRACTS.md sections 1.1, 1.7, and 5.7.3):
 * the status body is strict, `to` is one of the four targets, the carrier and tracking number are
 * accepted only with `to: "SHIPPED"`, and the list query caps the page size and strips what it
 * does not interpret.
 */
import { describe, expect, it } from "vitest";

import {
  CARRIER_NAME_MAX,
  listSellerOrdersQuerySchema,
  sellerOrderIdParamsSchema,
  sellerOrderStatusBodySchema,
  TRACKING_NUMBER_MAX,
} from "./seller-schema";

function issues(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; code: string }[] };
}) {
  return (result.error?.issues ?? []).map((issue) => ({
    path: issue.path.join("."),
    code: issue.code,
  }));
}

describe("sellerOrderStatusBodySchema", () => {
  it.each(["PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"])("accepts to: %s", (to) => {
    expect(sellerOrderStatusBodySchema.parse({ to })).toEqual({ to });
  });

  it.each(["PENDING", "processing", "LOST", "REFUNDED", "", 1, null])("refuses to: %s", (to) => {
    expect(sellerOrderStatusBodySchema.safeParse({ to }).success).toBe(false);
  });

  it("refuses a missing to", () => {
    expect(sellerOrderStatusBodySchema.safeParse({}).success).toBe(false);
  });

  it("accepts and trims the carrier and the tracking number with SHIPPED", () => {
    expect(
      sellerOrderStatusBodySchema.parse({
        to: "SHIPPED",
        carrierName: "  ไปรษณีย์ไทย ",
        trackingNumber: " EF123456789TH ",
      }),
    ).toEqual({ to: "SHIPPED", carrierName: "ไปรษณีย์ไทย", trackingNumber: "EF123456789TH" });
    expect(sellerOrderStatusBodySchema.parse({ to: "SHIPPED", carrierName: "Kerry" })).toEqual({
      to: "SHIPPED",
      carrierName: "Kerry",
    });
  });

  it.each(["PROCESSING", "DELIVERED", "CANCELLED"])(
    "refuses a carrier or tracking number with to: %s, at its own path",
    (to) => {
      expect(issues(sellerOrderStatusBodySchema.safeParse({ to, carrierName: "Kerry" }))).toEqual([
        { path: "carrierName", code: "custom" },
      ]);
      expect(
        issues(
          sellerOrderStatusBodySchema.safeParse({ to, trackingNumber: "T1", carrierName: "K" }),
        ),
      ).toEqual([
        { path: "carrierName", code: "custom" },
        { path: "trackingNumber", code: "custom" },
      ]);
    },
  );

  it("refuses empty, too long, multi-line, and control-character carrier and tracking texts", () => {
    for (const value of [
      "",
      "   ",
      "a".repeat(CARRIER_NAME_MAX + 1),
      "line\nbreak",
      "tab\there",
      "‮bidi",
    ]) {
      expect(
        sellerOrderStatusBodySchema.safeParse({ to: "SHIPPED", carrierName: value }).success,
      ).toBe(false);
    }
    expect(
      sellerOrderStatusBodySchema.safeParse({
        to: "SHIPPED",
        trackingNumber: "a".repeat(TRACKING_NUMBER_MAX + 1),
      }).success,
    ).toBe(false);
    expect(
      sellerOrderStatusBodySchema.safeParse({
        to: "SHIPPED",
        trackingNumber: "a".repeat(TRACKING_NUMBER_MAX),
      }).success,
    ).toBe(true);
    expect(
      sellerOrderStatusBodySchema.safeParse({ to: "SHIPPED", carrierName: null }).success,
    ).toBe(false);
  });

  it.each([
    "storeId",
    "sellerId",
    "userId",
    "fulfilmentStatus",
    "paymentStatus",
    "from",
    "priceSatang",
    "itemsSubtotalSatang",
    "shippingFeeSatang",
    "isSimulated",
  ])("refuses the unknown key %s (strict object)", (key) => {
    expect(issues(sellerOrderStatusBodySchema.safeParse({ to: "PROCESSING", [key]: "x" }))).toEqual(
      [{ path: "", code: "unrecognized_keys" }],
    );
  });

  it("refuses a body that is not an object", () => {
    for (const body of [null, [], "PROCESSING", 1]) {
      expect(sellerOrderStatusBodySchema.safeParse(body).success).toBe(false);
    }
  });
});

describe("listSellerOrdersQuerySchema", () => {
  it("defaults the page and strips what it does not interpret, a storeId included", () => {
    expect(
      listSellerOrdersQuerySchema.parse({ storeId: "other", paymentStatus: "PENDING" }),
    ).toEqual({ page: 1, pageSize: 20 });
  });

  it("accepts the fulfilment status filter", () => {
    expect(
      listSellerOrdersQuerySchema.parse({ fulfilmentStatus: "SHIPPED", page: "2", pageSize: "50" }),
    ).toEqual({ page: 2, pageSize: 50, fulfilmentStatus: "SHIPPED" });
  });

  it("refuses an unknown status, a repeated parameter, and a page size above 50", () => {
    for (const query of [
      { fulfilmentStatus: "LOST" },
      { fulfilmentStatus: "shipped" },
      { fulfilmentStatus: ["SHIPPED", "DELIVERED"] },
      { pageSize: "51" },
      { pageSize: "0" },
      { page: "0" },
    ]) {
      expect(listSellerOrdersQuerySchema.safeParse(query).success).toBe(false);
    }
  });
});

describe("sellerOrderIdParamsSchema", () => {
  it("checks the id for its form only", () => {
    expect(sellerOrderIdParamsSchema.parse({ id: "cm1abc" })).toEqual({ id: "cm1abc" });
    for (const id of ["", "a".repeat(201), "a\u0000b", "\ud800"]) {
      expect(sellerOrderIdParamsSchema.safeParse({ id }).success).toBe(false);
    }
  });
});
