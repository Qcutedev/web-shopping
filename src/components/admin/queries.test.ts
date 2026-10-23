import { describe, expect, it } from "vitest";
import {
  listHref,
  ORDER_KEYS,
  parseApplications,
  parseAuditLogs,
  parseOrders,
  parseProducts,
  parseReport,
  parseUsers,
  USER_KEYS,
} from "./queries";

describe("parseUsers", () => {
  it("reads the filters through the endpoint schema", () => {
    const parsed = parseUsers({ q: " ann ", role: "SELLER", isActive: "false", page: "2" });
    expect(parsed.query).toEqual({
      q: "ann",
      role: "SELLER",
      isActive: false,
      page: 2,
      pageSize: 20,
    });
    expect(parsed.ignored).toBe(false);
  });

  it("reads an empty select as no filter", () => {
    const parsed = parseUsers({ role: "", isActive: "" });
    expect(parsed.query.role).toBeUndefined();
    expect(parsed.query.isActive).toBeUndefined();
    expect(parsed.ignored).toBe(false);
  });

  it("drops one refused value and keeps the others", () => {
    const parsed = parseUsers({ role: "ROOT", isActive: "true" });
    expect(parsed.query.role).toBeUndefined();
    expect(parsed.query.isActive).toBe(true);
    expect(parsed.ignored).toBe(true);
    expect(parsed.params.has("role")).toBe(false);
  });

  it("falls back to the first page for a page that is not a number", () => {
    const parsed = parseUsers({ page: "abc" });
    expect(parsed.query.page).toBe(1);
    expect(parsed.ignored).toBe(true);
  });

  it("refuses a page size of 51 and keeps the default", () => {
    const parsed = parseUsers({ pageSize: "51" });
    expect(parsed.query.pageSize).toBe(20);
    expect(parsed.ignored).toBe(true);
  });

  it("ignores parameters it does not know", () => {
    const parsed = parseUsers({ role: "ADMIN", evil: "1" });
    expect(parsed.params.has("evil")).toBe(false);
  });
});

describe("parseApplications", () => {
  it("accepts a status", () => {
    expect(parseApplications({ status: "PENDING" }).query.status).toBe("PENDING");
  });
});

describe("parseProducts", () => {
  it("shows the approval queue by default", () => {
    const parsed = parseProducts({});
    expect(parsed.view).toBe("queue");
    expect(parsed.query.queue).toBe(true);
  });

  it("does not send a status filter with the queue", () => {
    const parsed = parseProducts({ status: "PUBLISHED", moderationStatus: "PENDING", q: "x" });
    expect(parsed.query.queue).toBe(true);
    expect(parsed.query.status).toBeUndefined();
    expect(parsed.query.moderationStatus).toBeUndefined();
    expect(parsed.query.q).toBe("x");
    expect(parsed.ignored).toBe(false);
    expect(parsed.params.has("status")).toBe(false);
  });

  it("lists every product with the filters when asked", () => {
    const parsed = parseProducts({
      view: "all",
      status: "PUBLISHED",
      moderationStatus: "REJECTED",
    });
    expect(parsed.view).toBe("all");
    expect(parsed.query.queue).toBeUndefined();
    expect(parsed.query.status).toBe("PUBLISHED");
    expect(parsed.query.moderationStatus).toBe("REJECTED");
    expect(parsed.params.get("view")).toBe("all");
  });
});

describe("parseOrders", () => {
  it("turns Bangkok days into half-open instants with the last day included", () => {
    const { query } = parseOrders({
      from: "2026-10-11",
      to: "2026-10-11",
      paidFrom: "2026-10-11",
      paidTo: "2026-10-12",
    });
    expect(query.from?.toISOString()).toBe("2026-10-10T17:00:00.000Z");
    expect(query.to?.toISOString()).toBe("2026-10-11T17:00:00.000Z");
    expect(query.paidFrom?.toISOString()).toBe("2026-10-10T17:00:00.000Z");
    expect(query.paidTo?.toISOString()).toBe("2026-10-12T17:00:00.000Z");
  });

  it("drops a paid range with one end, as the endpoint refuses it (Q44)", () => {
    const parsed = parseOrders({ paidFrom: "2026-10-11" });
    expect(parsed.query.paidFrom).toBeUndefined();
    expect(parsed.ignored).toBe(true);
  });

  it("drops a range whose last day is before its first day", () => {
    const parsed = parseOrders({ paidFrom: "2026-10-12", paidTo: "2026-10-11" });
    expect(parsed.query.paidFrom).toBeUndefined();
    expect(parsed.query.paidTo).toBeUndefined();
    expect(parsed.ignored).toBe(true);
  });

  it("drops a day that does not exist", () => {
    const parsed = parseOrders({ from: "2026-02-30" });
    expect(parsed.query.from).toBeUndefined();
    expect(parsed.ignored).toBe(true);
  });

  it("drops an order number that cannot be one and keeps the payment filter", () => {
    const parsed = parseOrders({ orderNumber: "OD 1;--", paymentStatus: "PAID" });
    expect(parsed.query.orderNumber).toBeUndefined();
    expect(parsed.query.paymentStatus).toBe("PAID");
    expect(parsed.ignored).toBe(true);
  });
});

describe("parseAuditLogs", () => {
  it("reads the word filters and the day range", () => {
    const parsed = parseAuditLogs({
      action: "STORE_SUSPENDED",
      targetType: "Store",
      from: "2026-10-11",
    });
    expect(parsed.query.action).toBe("STORE_SUSPENDED");
    expect(parsed.query.from?.toISOString()).toBe("2026-10-10T17:00:00.000Z");
  });

  it("drops an action that is not a word", () => {
    const parsed = parseAuditLogs({ action: "1; DROP" });
    expect(parsed.query.action).toBeUndefined();
    expect(parsed.ignored).toBe(true);
  });
});

describe("parseReport", () => {
  it("needs both ends", () => {
    expect(parseReport({}).query).toBeNull();
    expect(parseReport({ from: "2026-10-11" }).query).toBeNull();
  });

  it("is quiet when nothing was asked and says so when a range was refused", () => {
    expect(parseReport({})).toMatchObject({ ignored: false });
    expect(parseReport({ from: "2026-10-12", to: "2026-10-11" })).toMatchObject({ ignored: true });
  });

  it("reads one day as a range of that day", () => {
    const parsed = parseReport({ from: "2026-10-11", to: "2026-10-11" });
    expect(parsed.query?.from.toISOString()).toBe("2026-10-10T17:00:00.000Z");
    expect(parsed.query?.to.toISOString()).toBe("2026-10-11T17:00:00.000Z");
  });
});

describe("listHref", () => {
  it("keeps the filters, a non-default page size, and the page", () => {
    const parsed = parseUsers({ q: "ann", role: "SELLER", pageSize: "10" });
    expect(listHref("/admin/users", USER_KEYS, parsed.params, 10, 3)).toBe(
      "/admin/users?q=ann&role=SELLER&pageSize=10&page=3",
    );
  });

  it("leaves out the first page and the default size", () => {
    expect(listHref("/admin/users", USER_KEYS, new URLSearchParams(), 20, 1)).toBe("/admin/users");
  });

  it("keeps the day filters as days", () => {
    const parsed = parseOrders({ paidFrom: "2026-10-11", paidTo: "2026-10-12" });
    expect(listHref("/admin/orders", ORDER_KEYS, parsed.params, 20, 2)).toBe(
      "/admin/orders?paidFrom=2026-10-11&paidTo=2026-10-12&page=2",
    );
  });
});
