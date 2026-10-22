/**
 * Unit tests of the pure parts of the admin repository: the order list's `WHERE` (BR-40: the paid
 * range never matches an unpaid order), the product list's queue (BR-36: published and awaiting
 * approval, oldest submission first), and the search text escape. The statements themselves run
 * against PostgreSQL in tests/integration/admin (not written in T-050; see the report).
 */
import { describe, expect, it } from "vitest";

import { escapeLikePattern, orderListWhere, productListQuery } from "./repository";

describe("orderListWhere", () => {
  it("is an empty AND without filters", () => {
    expect(orderListWhere({})).toEqual({ AND: [] });
  });

  it("the paid range requires a paid order with a paid time, half-open (BR-39, BR-40)", () => {
    const paidFrom = new Date("2026-10-10T17:00:00Z");
    const paidTo = new Date("2026-10-11T17:00:00Z");
    expect(orderListWhere({ paidFrom, paidTo })).toEqual({
      AND: [
        { paymentStatus: "PAID", paidAt: { not: null } },
        { paidAt: { gte: paidFrom } },
        { paidAt: { lt: paidTo } },
      ],
    });
  });

  it("keeps the creation range separate from the paid range; both apply together", () => {
    const from = new Date("2026-10-10T00:00:00Z");
    const to = new Date("2026-10-12T00:00:00Z");
    const paidFrom = new Date("2026-10-11T00:00:00Z");
    const paidTo = new Date("2026-10-11T12:00:00Z");
    const where = orderListWhere({ from, to, paidFrom, paidTo });
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { createdAt: { gte: from } },
        { createdAt: { lt: to } },
        { paidAt: { gte: paidFrom } },
        { paidAt: { lt: paidTo } },
      ]),
    );
  });

  it("fulfilmentStatus and storeId are one condition on the same seller order", () => {
    expect(orderListWhere({ fulfilmentStatus: "SHIPPED", storeId: "s1" })).toEqual({
      AND: [{ sellerOrders: { some: { fulfilmentStatus: "SHIPPED", storeId: "s1" } } }],
    });
    expect(orderListWhere({ storeId: "s1" })).toEqual({
      AND: [{ sellerOrders: { some: { storeId: "s1" } } }],
    });
  });

  it("passes the exact filters on", () => {
    expect(orderListWhere({ paymentStatus: "FAILED", userId: "u1", orderNumber: "OD1" })).toEqual({
      AND: [{ paymentStatus: "FAILED" }, { userId: "u1" }, { orderNumber: "OD1" }],
    });
  });
});

describe("productListQuery", () => {
  it("the queue is PENDING and PUBLISHED, oldest submission first, then id (BR-36)", () => {
    expect(productListQuery({ queue: true })).toEqual({
      where: { AND: [{ moderationStatus: "PENDING", status: "PUBLISHED" }] },
      orderBy: [{ moderationRequestedAt: "asc" }, { id: "asc" }],
    });
  });

  it("any other list is newest first and can show unpublished products", () => {
    const query = productListQuery({ moderationStatus: "PENDING", status: "DRAFT", storeId: "s" });
    expect(query.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(query.where).toEqual({
      AND: [{ moderationStatus: "PENDING" }, { status: "DRAFT" }, { storeId: "s" }],
    });
  });

  it("matches the title as plain text", () => {
    expect(productListQuery({ q: "50%_off" }).where).toEqual({
      AND: [{ title: { contains: "50\\%\\_off", mode: "insensitive" } }],
    });
  });
});

describe("escapeLikePattern", () => {
  it("escapes the LIKE wildcards and the escape character only", () => {
    expect(escapeLikePattern("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
    expect(escapeLikePattern("ร้านค้า")).toBe("ร้านค้า");
  });
});
