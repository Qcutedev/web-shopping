/**
 * Unit tests of the admin service: the permission check (role `ADMIN` on every function, before
 * any query: a customer and a seller, approved or suspended, are 403 FORBIDDEN and nothing is
 * read or written; TM-07), the acting admin's id passed as the audit actor, the mapping of each
 * repository outcome to its error (404, 409 and its reason), and the admin's row of the fulfilment
 * table including the refusal of every move on a failed order (BR-20). The repository is replaced;
 * the statements run against PostgreSQL in the integration suite.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FULFILMENT_STATUSES, PAYMENT_STATUSES } from "@/modules/orders";
import type { Actor } from "@/server/auth/actor";
import { Prisma } from "@/server/db";
import { AppError, unauthenticated } from "@/server/errors";

const repo = vi.hoisted(() => ({
  listUsers: vi.fn(),
  deactivateUser: vi.fn(),
  reactivateUser: vi.fn(),
  listApplications: vi.fn(),
  listStores: vi.fn(),
  moveStoreStatus: vi.fn(),
  listProducts: vi.fn(),
  findProduct: vi.fn(),
  decideProduct: vi.fn(),
  listCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  listOrders: vi.fn(),
  findOrder: vi.fn(),
  moveSellerOrderAsAdmin: vi.fn(),
  readSettings: vi.fn(),
  updateSettings: vi.fn(),
  readSummaryRows: vi.fn(),
  readReportRows: vi.fn(),
  listAuditLogs: vi.fn(),
  listReviews: vi.fn(),
  moveReviewVisibility: vi.fn(),
}));
const sellers = vi.hoisted(() => ({
  approveApplication: vi.fn(),
  rejectApplication: vi.fn(),
}));

vi.mock("./repository", () => repo);
vi.mock("@/modules/sellers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/sellers")>()),
  ...sellers,
}));

const service = await import("./service");

function actor(role: Actor["role"], storeStatus: Actor["storeStatus"] = null): Actor {
  return Object.freeze({
    userId: "user_me",
    role,
    storeId: storeStatus === null ? null : "store_me",
    storeStatus,
  });
}

const ADMIN = actor("ADMIN");
const PAGE = { page: 1, pageSize: 20 };
const EMPTY = { rows: [], total: 0 };
const REPORT_RANGE = {
  from: new Date("2026-10-10T17:00:00Z"),
  to: new Date("2026-10-11T17:00:00Z"),
};

/** Every exported service function, called with valid input. */
const CALLS: [string, (who: Actor) => Promise<unknown>][] = [
  ["listUsers", (who) => service.listUsers(who, PAGE)],
  ["deactivateUser", (who) => service.deactivateUser(who, "u1")],
  ["reactivateUser", (who) => service.reactivateUser(who, "u1")],
  ["listApplications", (who) => service.listApplications(who, PAGE)],
  ["approveApplication", (who) => service.approveApplication(who, "a1")],
  ["rejectApplication", (who) => service.rejectApplication(who, "a1", { reason: "r" })],
  ["listStores", (who) => service.listStores(who, PAGE)],
  ["suspendStore", (who) => service.suspendStore(who, "s1", { reason: "r" })],
  ["reinstateStore", (who) => service.reinstateStore(who, "s1", { reason: "r" })],
  ["listProducts", (who) => service.listProducts(who, PAGE)],
  ["getProduct", (who) => service.getProduct(who, "p1")],
  ["approveProduct", (who) => service.approveProduct(who, "p1", { contentRevision: 1 })],
  ["rejectProduct", (who) => service.rejectProduct(who, "p1", { contentRevision: 1, reason: "r" })],
  [
    "takedownProduct",
    (who) => service.takedownProduct(who, "p1", { contentRevision: 1, reason: "r" }),
  ],
  ["listCategories", (who) => service.listCategories(who, PAGE)],
  ["createCategory", (who) => service.createCategory(who, { name: "c" })],
  ["updateCategory", (who) => service.updateCategory(who, "c1", { isActive: false })],
  ["deleteCategory", (who) => service.deleteCategory(who, "c1")],
  ["listOrders", (who) => service.listOrders(who, PAGE)],
  ["getOrder", (who) => service.getOrder(who, "o1")],
  [
    "changeSellerOrderStatus",
    (who) => service.changeSellerOrderStatus(who, "so1", { to: "CANCELLED" }),
  ],
  ["getSettings", (who) => service.getSettings(who)],
  ["updateSettings", (who) => service.updateSettings(who, { commissionRateBps: 500 })],
  ["getSummary", (who) => service.getSummary(who)],
  ["getReport", (who) => service.getReport(who, REPORT_RANGE)],
  ["listAuditLogs", (who) => service.listAuditLogs(who, PAGE)],
  ["listReviews", (who) => service.listReviews(who, PAGE)],
  ["hideReview", (who) => service.hideReview(who, "r1", { reason: "spam" })],
  ["unhideReview", (who) => service.unhideReview(who, "r1", {})],
];

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    const appError = error as AppError;
    const reason = (appError.details as { reason?: string }).reason;
    return reason === undefined ? appError.code : `${appError.code} ${reason}`;
  }
  throw new Error("expected a refusal");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("every admin service function requires the role ADMIN before any query (TM-07)", () => {
  const NON_ADMINS = [
    ["a customer", actor("CUSTOMER")],
    ["an approved seller", actor("SELLER", "APPROVED")],
    ["a suspended seller", actor("SELLER", "SUSPENDED")],
  ] as const;

  it("covers every exported function", () => {
    const exported = Object.entries(service)
      .filter(([name, value]) => typeof value === "function" && name !== "adminMayMove")
      .map(([name]) => name)
      .sort();
    expect(CALLS.map(([name]) => name).sort()).toEqual(exported);
  });

  for (const [name, call] of CALLS) {
    for (const [label, who] of NON_ADMINS) {
      it(`${name}: ${label} is 403 FORBIDDEN and nothing is read or written`, async () => {
        expect(await codeOf(call(who))).toBe("FORBIDDEN");
        for (const fn of Object.values(repo)) expect(fn).not.toHaveBeenCalled();
        expect(sellers.approveApplication).not.toHaveBeenCalled();
        expect(sellers.rejectApplication).not.toHaveBeenCalled();
      });
    }
  }
});

describe("users", () => {
  it("passes the filters and the page; the admin's id is the audit actor", async () => {
    repo.listUsers.mockResolvedValue(EMPTY);
    await service.listUsers(ADMIN, { ...PAGE, q: "a", role: "SELLER", isActive: false });
    expect(repo.listUsers).toHaveBeenCalledWith(
      { q: "a", role: "SELLER", isActive: false },
      expect.objectContaining(PAGE),
    );
    repo.deactivateUser.mockResolvedValue({ kind: "not-found" });
    await codeOf(service.deactivateUser(ADMIN, "u1"));
    expect(repo.deactivateUser).toHaveBeenCalledWith("u1", "user_me");
  });

  it.each([
    ["not-found", "NOT_FOUND"],
    ["self", "CONFLICT SELF_DEACTIVATION"],
    ["invalid-state", "INVALID_STATE_TRANSITION"],
    ["last-admin", "CONFLICT LAST_ADMIN"],
  ])("deactivate outcome %s is %s", async (kind, code) => {
    repo.deactivateUser.mockResolvedValue({ kind });
    expect(await codeOf(service.deactivateUser(ADMIN, "u1"))).toBe(code);
  });

  it("reactivate of an active user is 409 INVALID_STATE_TRANSITION", async () => {
    repo.reactivateUser.mockResolvedValue({ kind: "invalid-state" });
    expect(await codeOf(service.reactivateUser(ADMIN, "u1"))).toBe("INVALID_STATE_TRANSITION");
  });
});

describe("applications and stores", () => {
  it("the decisions are the sellers module's, called with the session's actor", async () => {
    sellers.approveApplication.mockResolvedValue({ application: {}, store: null });
    sellers.rejectApplication.mockResolvedValue({ application: {}, store: null });
    await service.approveApplication(ADMIN, "a1");
    await service.rejectApplication(ADMIN, "a1", { reason: "r" });
    expect(sellers.approveApplication).toHaveBeenCalledWith(ADMIN, "a1");
    expect(sellers.rejectApplication).toHaveBeenCalledWith(ADMIN, "a1", { reason: "r" });
  });

  // SEC-096 remediation (b): the decision is one transaction that starts with the acting-admin
  // check, so a deadlock runs the whole decision again; anything else is not retried.
  it("a decision aborted by a deadlock is run again as a whole", async () => {
    const deadlock = new Prisma.PrismaClientKnownRequestError("failed", {
      code: "P2010",
      clientVersion: "test",
      meta: { driverAdapterError: { cause: { originalCode: "40P01" } } },
    });
    const decided = { application: {}, store: null };
    sellers.approveApplication.mockRejectedValueOnce(deadlock).mockResolvedValueOnce(decided);
    sellers.rejectApplication.mockRejectedValueOnce(deadlock).mockResolvedValueOnce(decided);
    expect(await service.approveApplication(ADMIN, "a1")).toBe(decided);
    expect(await service.rejectApplication(ADMIN, "a1", { reason: "r" })).toBe(decided);
    expect(sellers.approveApplication).toHaveBeenCalledTimes(2);
    expect(sellers.rejectApplication).toHaveBeenCalledTimes(2);
  });

  it("a decision refused with an AppError is not run again", async () => {
    sellers.approveApplication.mockRejectedValueOnce(unauthenticated());
    expect(await codeOf(service.approveApplication(ADMIN, "a1"))).toBe("UNAUTHENTICATED");
    expect(sellers.approveApplication).toHaveBeenCalledTimes(1);
  });

  it("suspend and reinstate pass the target status and the reason; outcomes map to 404 and 409", async () => {
    repo.moveStoreStatus.mockResolvedValue({ kind: "not-found" });
    expect(await codeOf(service.suspendStore(ADMIN, "s1", { reason: "r" }))).toBe("NOT_FOUND");
    expect(repo.moveStoreStatus).toHaveBeenCalledWith("s1", "SUSPENDED", "r", "user_me");
    repo.moveStoreStatus.mockResolvedValue({ kind: "invalid-state" });
    expect(await codeOf(service.reinstateStore(ADMIN, "s1", { reason: "r" }))).toBe(
      "INVALID_STATE_TRANSITION",
    );
    expect(repo.moveStoreStatus).toHaveBeenLastCalledWith("s1", "APPROVED", "r", "user_me");
  });
});

describe("product moderation", () => {
  it("an unknown product is 404", async () => {
    repo.findProduct.mockResolvedValue(null);
    expect(await codeOf(service.getProduct(ADMIN, "p1"))).toBe("NOT_FOUND");
  });

  it.each([
    ["not-found", "NOT_FOUND"],
    ["stale-revision", "CONFLICT STALE_REVISION"],
    ["invalid-state", "INVALID_STATE_TRANSITION"],
  ])("decision outcome %s is %s", async (kind, code) => {
    repo.decideProduct.mockResolvedValue({ kind });
    expect(await codeOf(service.approveProduct(ADMIN, "p1", { contentRevision: 2 }))).toBe(code);
  });

  it("passes the decision, the revision seen, the reason, and a judge from the one table", async () => {
    repo.decideProduct.mockResolvedValue({ kind: "not-found" });
    await codeOf(service.rejectProduct(ADMIN, "p1", { contentRevision: 3, reason: "ภาพ" }));
    const [id, decision, seen, reason, adminId, judge] = repo.decideProduct.mock.calls[0] as [
      string,
      string,
      number,
      string,
      string,
      (current: object) => string,
    ];
    expect([id, decision, seen, reason, adminId]).toEqual(["p1", "reject", 3, "ภาพ", "user_me"]);
    expect(judge({ status: "PUBLISHED", moderationStatus: "PENDING", contentRevision: 3 })).toBe(
      "ok",
    );
    expect(judge({ status: "DRAFT", moderationStatus: "PENDING", contentRevision: 3 })).toBe(
      "invalid-state",
    );
    expect(judge({ status: "PUBLISHED", moderationStatus: "PENDING", contentRevision: 4 })).toBe(
      "stale-revision",
    );
    await codeOf(service.approveProduct(ADMIN, "p1", { contentRevision: 3 }));
    expect(repo.decideProduct.mock.calls[1]?.[3]).toBeNull();
  });
});

describe("categories", () => {
  it("delete outcomes map to 404 and 409 CATEGORY_HAS_PRODUCTS; a delete answers DELETED", async () => {
    repo.deleteCategory.mockResolvedValue({ kind: "has-products" });
    expect(await codeOf(service.deleteCategory(ADMIN, "c1"))).toBe(
      "CONFLICT CATEGORY_HAS_PRODUCTS",
    );
    repo.deleteCategory.mockResolvedValue({ kind: "not-found" });
    expect(await codeOf(service.deleteCategory(ADMIN, "c1"))).toBe("NOT_FOUND");
    repo.deleteCategory.mockResolvedValue({ kind: "deleted" });
    expect(await service.deleteCategory(ADMIN, "c1")).toEqual({ outcome: "DELETED" });
  });

  it("update of an unknown category is 404", async () => {
    repo.updateCategory.mockResolvedValue({ kind: "not-found" });
    expect(await codeOf(service.updateCategory(ADMIN, "c1", { name: "n" }))).toBe("NOT_FOUND");
    expect(repo.updateCategory).toHaveBeenCalledWith("c1", { name: "n" }, "user_me");
  });
});

describe("orders", () => {
  it("an unknown order and an unknown seller order are 404", async () => {
    repo.findOrder.mockResolvedValue(null);
    expect(await codeOf(service.getOrder(ADMIN, "o1"))).toBe("NOT_FOUND");
    repo.moveSellerOrderAsAdmin.mockResolvedValue({ kind: "not-found" });
    expect(await codeOf(service.changeSellerOrderStatus(ADMIN, "so1", { to: "DELIVERED" }))).toBe(
      "NOT_FOUND",
    );
    repo.moveSellerOrderAsAdmin.mockResolvedValue({ kind: "invalid-state" });
    expect(await codeOf(service.changeSellerOrderStatus(ADMIN, "so1", { to: "CANCELLED" }))).toBe(
      "INVALID_STATE_TRANSITION",
    );
  });

  it("passes the paid-date filter on", async () => {
    repo.listOrders.mockResolvedValue(EMPTY);
    const paidFrom = new Date("2026-10-10T17:00:00Z");
    const paidTo = new Date("2026-10-11T17:00:00Z");
    await service.listOrders(ADMIN, { ...PAGE, paidFrom, paidTo, paymentStatus: "PAID" });
    expect(repo.listOrders).toHaveBeenCalledWith(
      { paymentStatus: "PAID", paidFrom, paidTo },
      expect.objectContaining(PAGE),
    );
  });

  describe("adminMayMove: the admin's rows of the fulfilment table (REQ-A-07, BR-20, BR-29)", () => {
    const allowed: Record<string, readonly string[]> = {
      CANCELLED: ["PENDING", "PROCESSING"],
      DELIVERED: ["SHIPPED"],
    };
    for (const to of ["CANCELLED", "DELIVERED"] as const) {
      for (const from of FULFILMENT_STATUSES) {
        for (const paymentStatus of PAYMENT_STATUSES) {
          const expected = paymentStatus !== "FAILED" && (allowed[to] ?? []).includes(from);
          it(`${from} to ${to} with payment ${paymentStatus}: ${expected}`, () => {
            expect(service.adminMayMove({ fulfilmentStatus: from, paymentStatus }, to)).toBe(
              expected,
            );
          });
        }
      }
    }
  });
});

describe("settings, summary, report, audit", () => {
  it("passes only the changed fields and the admin's id", async () => {
    repo.updateSettings.mockResolvedValue({
      flatShippingFeeSatang: 0,
      commissionRateBps: 500,
      updatedAt: new Date(),
      updatedById: "user_me",
    });
    await service.updateSettings(ADMIN, { flatShippingFeeSatang: 0 });
    expect(repo.updateSettings).toHaveBeenCalledWith({ flatShippingFeeSatang: 0 }, "user_me");
  });

  it("the report reads its range", async () => {
    repo.readReportRows.mockResolvedValue({
      orderCount: 0,
      paidRevenue: "0",
      newUserCount: 0,
      newSellerCount: 0,
    });
    await service.getReport(ADMIN, REPORT_RANGE);
    expect(repo.readReportRows).toHaveBeenCalledWith(REPORT_RANGE.from, REPORT_RANGE.to);
  });

  it("the audit list passes its filters", async () => {
    repo.listAuditLogs.mockResolvedValue(EMPTY);
    await service.listAuditLogs(ADMIN, { ...PAGE, action: "STORE_SUSPENDED", targetId: "s1" });
    expect(repo.listAuditLogs).toHaveBeenCalledWith(
      { action: "STORE_SUSPENDED", targetId: "s1" },
      expect.objectContaining(PAGE),
    );
  });
});

describe("review moderation (SEC-092)", () => {
  const REVIEW_ROW = {
    id: "r1",
    productId: "p1",
    userId: "u1",
    rating: 1,
    comment: "text",
    createdAt: new Date("2026-10-20T00:00:00Z"),
    hiddenAt: new Date("2026-10-28T00:00:00Z"),
    hiddenByUserId: "user_me",
    hiddenReason: "spam",
    product: { id: "p1", title: "T", slug: "t" },
    author: { id: "u1", name: "A" },
  };

  it("list passes the filters and the page", async () => {
    repo.listReviews.mockResolvedValue(EMPTY);
    await service.listReviews(ADMIN, { ...PAGE, productId: "p1", hidden: true });
    expect(repo.listReviews).toHaveBeenCalledWith(
      { productId: "p1", hidden: true },
      expect.objectContaining(PAGE),
    );
  });

  it("hide passes the reason and the session's admin id; the row maps to AdminReviewDto", async () => {
    repo.moveReviewVisibility.mockResolvedValue({ kind: "done", row: REVIEW_ROW });
    const dto = await service.hideReview(ADMIN, "r1", { reason: "spam" });
    expect(repo.moveReviewVisibility).toHaveBeenCalledWith("r1", "hide", "spam", "user_me");
    expect(dto).toEqual({
      id: "r1",
      rating: 1,
      comment: "text",
      createdAt: "2026-10-20T00:00:00.000Z",
      product: { id: "p1", title: "T", slug: "t" },
      author: { id: "u1", name: "A" },
      hiddenAt: "2026-10-28T00:00:00.000Z",
      hiddenByUserId: "user_me",
      hiddenReason: "spam",
    });
  });

  it("an absent or null reason is passed as null", async () => {
    repo.moveReviewVisibility.mockResolvedValue({ kind: "done", row: REVIEW_ROW });
    await service.hideReview(ADMIN, "r1", {});
    expect(repo.moveReviewVisibility).toHaveBeenLastCalledWith("r1", "hide", null, "user_me");
    await service.unhideReview(ADMIN, "r1", { reason: null });
    expect(repo.moveReviewVisibility).toHaveBeenLastCalledWith("r1", "unhide", null, "user_me");
  });

  it.each([
    ["not-found", "NOT_FOUND"],
    ["invalid-state", "INVALID_STATE_TRANSITION"],
  ])("hide and unhide outcome %s is %s", async (kind, code) => {
    repo.moveReviewVisibility.mockResolvedValue({ kind });
    expect(await codeOf(service.hideReview(ADMIN, "r1", {}))).toBe(code);
    expect(await codeOf(service.unhideReview(ADMIN, "r1", {}))).toBe(code);
  });
});
