/**
 * Unit tests of the admin contract's schemas (docs/API_CONTRACTS.md sections 1.6, 1.7, and 5.9):
 * the page size cap of 50 on every list (REQ-N-06), strict bodies (no role, no moderation switch,
 * no amount), the settings bounds of BR-28, the queue filter of BR-36, the instants of section
 * 1.6, and the paid-date range of BR-40.
 */
import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";

import {
  adminSellerOrderStatusBodySchema,
  approveProductBodySchema,
  createCategoryBodySchema,
  idParamsSchema,
  listApplicationsQuerySchema,
  listAuditLogsQuerySchema,
  listCategoriesQuerySchema,
  listOrdersQuerySchema,
  listProductsQuerySchema,
  listReviewsQuerySchema,
  listStoresQuerySchema,
  listUsersQuerySchema,
  MAX_PAGE_SIZE,
  productReasonBodySchema,
  reportQuerySchema,
  reviewModerationBodySchema,
  storeReasonBodySchema,
  updateCategoryBodySchema,
  updateSettingsBodySchema,
} from "./schema";

function accepts(schema: ZodType, input: unknown): boolean {
  return schema.safeParse(input).success;
}

const LISTS: [string, ZodType][] = [
  ["users", listUsersQuerySchema],
  ["applications", listApplicationsQuerySchema],
  ["stores", listStoresQuerySchema],
  ["products", listProductsQuerySchema],
  ["categories", listCategoriesQuerySchema],
  ["orders", listOrdersQuerySchema],
  ["audit logs", listAuditLogsQuerySchema],
  ["reviews", listReviewsQuerySchema],
];

describe("every admin list is paginated with a page size of at most 50 (REQ-N-06)", () => {
  it.each(LISTS)("%s: 50 is accepted, 51 and 0 are refused, the default is 20", (_name, schema) => {
    expect(MAX_PAGE_SIZE).toBe(50);
    expect(accepts(schema, { pageSize: "50" })).toBe(true);
    expect(accepts(schema, { pageSize: "51" })).toBe(false);
    expect(accepts(schema, { pageSize: "0" })).toBe(false);
    expect(accepts(schema, { page: "0" })).toBe(false);
    expect(accepts(schema, { pageSize: ["10", "20"] })).toBe(false);
    expect(schema.parse({})).toMatchObject({ page: 1, pageSize: 20 });
  });

  it.each(LISTS)("%s: an unknown parameter (role, storeId of the caller) is stripped", (_n, s) => {
    const parsed = s.parse({ sessionUserId: "x", isAdmin: "true" }) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("sessionUserId");
    expect(parsed).not.toHaveProperty("isAdmin");
  });
});

describe("user list", () => {
  it("parses q, role, isActive", () => {
    expect(
      listUsersQuerySchema.parse({ q: "  50%_a ", role: "SELLER", isActive: "false" }),
    ).toEqual({ page: 1, pageSize: 20, q: "50%_a", role: "SELLER", isActive: false });
    expect(listUsersQuerySchema.parse({ q: "   " }).q).toBeUndefined();
    expect(accepts(listUsersQuerySchema, { role: "ROOT" })).toBe(false);
    expect(accepts(listUsersQuerySchema, { isActive: "yes" })).toBe(false);
    expect(accepts(listUsersQuerySchema, { q: "x".repeat(101) })).toBe(false);
    expect(accepts(listUsersQuerySchema, { q: "a\u0000b" })).toBe(false);
  });
});

describe("product list (BR-36)", () => {
  it("queue accepts only true and cannot be combined with moderationStatus or status", () => {
    expect(listProductsQuerySchema.parse({ queue: "true" }).queue).toBe(true);
    expect(accepts(listProductsQuerySchema, { queue: "false" })).toBe(false);
    expect(accepts(listProductsQuerySchema, { queue: "true", status: "PUBLISHED" })).toBe(false);
    expect(accepts(listProductsQuerySchema, { queue: "true", moderationStatus: "PENDING" })).toBe(
      false,
    );
    expect(accepts(listProductsQuerySchema, { queue: "true", storeId: "s1", q: "x" })).toBe(true);
    expect(accepts(listProductsQuerySchema, { moderationStatus: "PENDING", status: "DRAFT" })).toBe(
      true,
    );
  });
});

describe("order list (BR-40, section 1.6)", () => {
  it("accepts instants with Z or an offset and refuses those without", () => {
    const parsed = listOrdersQuerySchema.parse({
      from: "2026-10-10T17:00:00Z",
      to: "2026-10-11T07:00:00+07:00",
    });
    expect(parsed.from?.toISOString()).toBe("2026-10-10T17:00:00.000Z");
    expect(parsed.to?.toISOString()).toBe("2026-10-11T00:00:00.000Z");
    for (const value of [
      "2026-10-10",
      "2026-10-10T17:00:00",
      "yesterday",
      "2026-02-30T00:00:00Z",
    ]) {
      expect(accepts(listOrdersQuerySchema, { from: value }), value).toBe(false);
    }
  });

  it("refuses a creation range whose end is not after its start", () => {
    expect(
      accepts(listOrdersQuerySchema, { from: "2026-10-11T00:00:00Z", to: "2026-10-11T00:00:00Z" }),
    ).toBe(false);
    expect(
      accepts(listOrdersQuerySchema, { from: "2026-10-12T00:00:00Z", to: "2026-10-11T00:00:00Z" }),
    ).toBe(false);
    expect(accepts(listOrdersQuerySchema, { from: "2026-10-11T00:00:00Z" })).toBe(true);
  });

  it("the paid range needs both ends, and its end after its start (BR-40 (5); Q44 open)", () => {
    const oneDay = { paidFrom: "2026-10-10T17:00:00Z", paidTo: "2026-10-11T17:00:00Z" };
    expect(accepts(listOrdersQuerySchema, oneDay)).toBe(true);
    expect(accepts(listOrdersQuerySchema, { paidFrom: oneDay.paidFrom })).toBe(false);
    expect(accepts(listOrdersQuerySchema, { paidTo: oneDay.paidTo })).toBe(false);
    expect(
      accepts(listOrdersQuerySchema, { paidFrom: oneDay.paidTo, paidTo: oneDay.paidFrom }),
    ).toBe(false);
    expect(
      accepts(listOrdersQuerySchema, {
        ...oneDay,
        from: "2026-10-10T00:00:00Z",
        paymentStatus: "PAID",
      }),
    ).toBe(true);
  });

  it("checks the other filters", () => {
    expect(accepts(listOrdersQuerySchema, { orderNumber: "OD2610110000042" })).toBe(true);
    expect(accepts(listOrdersQuerySchema, { orderNumber: "OD%" })).toBe(false);
    expect(accepts(listOrdersQuerySchema, { orderNumber: "O".repeat(25) })).toBe(false);
    expect(accepts(listOrdersQuerySchema, { paymentStatus: "REFUNDED" })).toBe(false);
    expect(accepts(listOrdersQuerySchema, { fulfilmentStatus: "LOST" })).toBe(false);
  });
});

describe("report (REQ-A-08)", () => {
  it("needs both ends, with offsets, start before end", () => {
    expect(
      reportQuerySchema.parse({ from: "2026-10-10T17:00:00Z", to: "2026-10-11T17:00:00Z" }),
    ).toEqual({
      from: new Date("2026-10-10T17:00:00Z"),
      to: new Date("2026-10-11T17:00:00Z"),
    });
    expect(accepts(reportQuerySchema, { from: "2026-10-10T17:00:00Z" })).toBe(false);
    expect(accepts(reportQuerySchema, { from: "2026-10-10", to: "2026-10-11" })).toBe(false);
    expect(
      accepts(reportQuerySchema, { from: "2026-10-11T17:00:00Z", to: "2026-10-10T17:00:00Z" }),
    ).toBe(false);
  });
});

describe("audit log list", () => {
  it("accepts the filters and refuses a malformed action", () => {
    expect(
      accepts(listAuditLogsQuerySchema, {
        actorId: "u1",
        action: "STORE_SUSPENDED",
        targetType: "Store",
        targetId: "s1",
        from: "2026-10-10T00:00:00Z",
      }),
    ).toBe(true);
    expect(accepts(listAuditLogsQuerySchema, { action: "DROP TABLE" })).toBe(false);
  });
});

describe("mutation bodies are strict (section 1.1)", () => {
  it("a reason is required and not blank; an unknown key is refused", () => {
    expect(accepts(storeReasonBodySchema, { reason: "ละเมิดนโยบาย" })).toBe(true);
    expect(accepts(storeReasonBodySchema, { reason: "   " })).toBe(false);
    expect(accepts(storeReasonBodySchema, {})).toBe(false);
    expect(accepts(storeReasonBodySchema, { reason: "x", status: "SUSPENDED" })).toBe(false);
    expect(accepts(storeReasonBodySchema, { reason: "x".repeat(501) })).toBe(false);
  });

  it("moderation bodies need the revision; reject and takedown need a reason", () => {
    expect(accepts(approveProductBodySchema, { contentRevision: 3 })).toBe(true);
    expect(accepts(approveProductBodySchema, {})).toBe(false);
    expect(accepts(approveProductBodySchema, { contentRevision: "3" })).toBe(false);
    expect(accepts(approveProductBodySchema, { contentRevision: 1.5 })).toBe(false);
    expect(accepts(approveProductBodySchema, { contentRevision: 0 })).toBe(false);
    expect(accepts(approveProductBodySchema, { contentRevision: 1, reason: "x" })).toBe(false);
    expect(accepts(productReasonBodySchema, { contentRevision: 1, reason: "ภาพไม่ชัด" })).toBe(
      true,
    );
    expect(accepts(productReasonBodySchema, { contentRevision: 1 })).toBe(false);
    expect(accepts(productReasonBodySchema, { contentRevision: 1, reason: "" })).toBe(false);
    expect(
      accepts(productReasonBodySchema, {
        contentRevision: 1,
        reason: "x",
        moderationStatus: "APPROVED",
      }),
    ).toBe(false);
  });

  it("an admin moves a seller order only to CANCELLED or DELIVERED", () => {
    expect(accepts(adminSellerOrderStatusBodySchema, { to: "CANCELLED" })).toBe(true);
    expect(accepts(adminSellerOrderStatusBodySchema, { to: "DELIVERED" })).toBe(true);
    for (const to of ["PROCESSING", "SHIPPED", "PENDING", "REFUNDED"]) {
      expect(accepts(adminSellerOrderStatusBodySchema, { to }), to).toBe(false);
    }
    expect(accepts(adminSellerOrderStatusBodySchema, { to: "CANCELLED", reason: "x" })).toBe(false);
  });

  it("category bodies", () => {
    expect(createCategoryBodySchema.parse({ name: " เสื้อผ้า " })).toEqual({ name: "เสื้อผ้า" });
    expect(accepts(createCategoryBodySchema, { name: "x", sortOrder: -1 })).toBe(false);
    expect(accepts(createCategoryBodySchema, { name: "x", sortOrder: 1.5 })).toBe(false);
    expect(accepts(createCategoryBodySchema, { name: "x", slug: "x" })).toBe(false);
    expect(accepts(createCategoryBodySchema, { name: "x", isActive: false })).toBe(false);
    expect(accepts(createCategoryBodySchema, { name: "" })).toBe(false);
    expect(accepts(createCategoryBodySchema, { name: "x".repeat(101) })).toBe(false);
    expect(accepts(updateCategoryBodySchema, { isActive: false })).toBe(true);
    expect(accepts(updateCategoryBodySchema, {})).toBe(false);
    expect(accepts(updateCategoryBodySchema, { slug: "new" })).toBe(false);
    expect(accepts(updateCategoryBodySchema, { isActive: "false" })).toBe(false);
  });

  it("path ids are opaque, non-empty, without U+0000", () => {
    expect(accepts(idParamsSchema, { id: "abc" })).toBe(true);
    expect(accepts(idParamsSchema, { id: "" })).toBe(false);
    expect(accepts(idParamsSchema, { id: "a\u0000" })).toBe(false);
    expect(accepts(idParamsSchema, { id: "x".repeat(201) })).toBe(false);
  });
});

describe("settings (REQ-A-09, BR-17, BR-28)", () => {
  it("accepts the boundary values", () => {
    for (const body of [
      { flatShippingFeeSatang: 0 },
      { flatShippingFeeSatang: 100_000 },
      { commissionRateBps: 0 },
      { commissionRateBps: 10_000 },
      { commissionRateBps: 500, flatShippingFeeSatang: 4_000 },
    ]) {
      expect(accepts(updateSettingsBodySchema, body), JSON.stringify(body)).toBe(true);
    }
  });

  it("refuses values out of bounds, fractions, decimals of a percent, and non-numbers", () => {
    for (const body of [
      { flatShippingFeeSatang: -1 },
      { flatShippingFeeSatang: 100_001 },
      { flatShippingFeeSatang: 40.5 },
      { flatShippingFeeSatang: "4000" },
      { commissionRateBps: -100 },
      { commissionRateBps: 10_100 },
      { commissionRateBps: 250 },
      { commissionRateBps: 1 },
      { commissionRateBps: null },
      {},
    ]) {
      expect(accepts(updateSettingsBodySchema, body), JSON.stringify(body)).toBe(false);
    }
  });

  it("has no moderation switch and no other key (BR-17)", () => {
    expect(accepts(updateSettingsBodySchema, { requireProductApproval: false })).toBe(false);
    expect(
      accepts(updateSettingsBodySchema, { commissionRateBps: 500, requireProductApproval: false }),
    ).toBe(false);
    expect(accepts(updateSettingsBodySchema, { commissionRateBps: 500, updatedById: "u" })).toBe(
      false,
    );
  });
});

describe("review moderation (SEC-092)", () => {
  it("list parses productId and hidden", () => {
    expect(listReviewsQuerySchema.parse({ productId: "p1", hidden: "true" })).toEqual({
      page: 1,
      pageSize: 20,
      productId: "p1",
      hidden: true,
    });
    expect(listReviewsQuerySchema.parse({ hidden: "false" }).hidden).toBe(false);
    expect(accepts(listReviewsQuerySchema, { hidden: "yes" })).toBe(false);
    expect(accepts(listReviewsQuerySchema, { productId: "" })).toBe(false);
    expect(accepts(listReviewsQuerySchema, { productId: "x".repeat(201) })).toBe(false);
  });

  it("the body is strict, the reason optional and 1 to 500 characters after normalisation", () => {
    expect(reviewModerationBodySchema.parse({})).toEqual({});
    expect(reviewModerationBodySchema.parse({ reason: null })).toEqual({ reason: null });
    expect(reviewModerationBodySchema.parse({ reason: "  สแปม \r\n" })).toEqual({ reason: "สแปม" });
    expect(accepts(reviewModerationBodySchema, { reason: "ก".repeat(500) })).toBe(true);
    expect(accepts(reviewModerationBodySchema, { reason: "ก".repeat(501) })).toBe(false);
    expect(accepts(reviewModerationBodySchema, { reason: "   " })).toBe(false);
    expect(accepts(reviewModerationBodySchema, { reason: "" })).toBe(false);
    expect(accepts(reviewModerationBodySchema, { reason: 5 })).toBe(false);
    for (const key of ["hiddenAt", "hiddenByUserId", "userId", "productId", "rating", "comment"]) {
      expect(accepts(reviewModerationBodySchema, { [key]: "x" })).toBe(false);
    }
  });
});
