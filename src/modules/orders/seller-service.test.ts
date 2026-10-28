/**
 * Unit tests of the seller order service: the permission checks (role `SELLER` on every function,
 * whatever the store's status, before any query; the scope is the session's store and owner), not
 * found for a foreign, unknown, or unpaid seller order, the transition table for the actor
 * `SELLER` (every pair of statuses), and the effect of each move inside the one transaction. The
 * database and the repository are replaced; tests/integration/seller-orders runs the same paths
 * against PostgreSQL.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Actor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";

import type { SellerOrderViewRow } from "./seller-repository";
import {
  FULFILMENT_STATUSES,
  type FulfilmentStatusValue,
  SELLER_DELIVERY_MIN_HOURS_AFTER_SHIPPED,
} from "./state";

const calls: string[] = [];

vi.mock("@/server/db", () => ({
  db: {
    $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => {
      calls.push("begin");
      return run({ tx: true });
    }),
  },
}));

vi.mock("@/modules/inventory", () => ({ LOW_STOCK_THRESHOLD: 5 }));

const ROW: SellerOrderViewRow = {
  id: "so1",
  storeName: "S",
  fulfilmentStatus: "PENDING",
  itemsSubtotalSatang: 100,
  shippingFeeSatang: 4_000,
  shippingFeeIsSimulated: true,
  commissionRateBps: 500,
  order: {
    orderNumber: "OD1",
    createdAt: new Date("2026-10-20T00:00:00Z"),
    paidAt: new Date("2026-10-20T00:00:01Z"),
    paymentStatus: "PAID",
    shipRecipientName: "r",
    shipPhone: "0812345678",
    shipLine1: "l",
    shipSubdistrict: "s",
    shipDistrict: "d",
    shipProvince: "p",
    shipPostalCode: "10110",
  },
  shipment: null,
  items: [],
};

let lockedStatus: FulfilmentStatusValue | null = "PENDING";

const repo = {
  lockOwnPaidSellerOrder: vi.fn(async () => {
    calls.push("lock");
    return lockedStatus === null ? null : { id: "so1", fulfilmentStatus: lockedStatus };
  }),
  moveSellerOrderStatus: vi.fn(async () => {
    calls.push("move");
    return true;
  }),
  insertShipment: vi.fn(async () => {
    calls.push("shipment");
  }),
  readSellerDeliveryEligibility: vi.fn(async (): Promise<"ELIGIBLE" | "TOO_EARLY" | null> => {
    calls.push("eligibility");
    return "ELIGIBLE";
  }),
  markShipmentDeliveredBySeller: vi.fn(async () => {
    calls.push("delivered");
    return true;
  }),
  claimAndRestoreStock: vi.fn(async () => {
    calls.push("restore");
    return 1;
  }),
  findOwnPaidSellerOrder: vi.fn(async (): Promise<SellerOrderViewRow | null> => {
    calls.push("read");
    return ROW;
  }),
  readOwnPaidSellerOrder: vi.fn(async (): Promise<SellerOrderViewRow | null> => {
    calls.push("snapshot read");
    return ROW;
  }),
  listOwnPaidSellerOrders: vi.fn(async () => ({ rows: [ROW], total: 1 })),
  readSellerSummaryRows: vi.fn(async () => ({
    productsByStatus: [],
    lowStockCount: 0,
    soldOutCount: 0,
    ordersByStatus: [],
    paidSalesTotal: "0",
  })),
};

vi.mock("./seller-repository", () => ({
  SELLER_ORDER_TRANSACTION_OPTIONS: {},
  ...Object.fromEntries(
    Object.keys({
      lockOwnPaidSellerOrder: 0,
      moveSellerOrderStatus: 0,
      insertShipment: 0,
      readSellerDeliveryEligibility: 0,
      markShipmentDeliveredBySeller: 0,
      claimAndRestoreStock: 0,
      findOwnPaidSellerOrder: 0,
      readOwnPaidSellerOrder: 0,
      listOwnPaidSellerOrders: 0,
      readSellerSummaryRows: 0,
    }).map((name) => [
      name,
      (...args: unknown[]) =>
        (repo as Record<string, (...a: unknown[]) => unknown>)[name]?.(...args),
    ]),
  ),
}));

/** The next age check answers `answer`, still recorded in `calls`. */
function eligibilityOnce(answer: "ELIGIBLE" | "TOO_EARLY" | null): void {
  repo.readSellerDeliveryEligibility.mockImplementationOnce(async () => {
    calls.push("eligibility");
    return answer;
  });
}

const service = await import("./seller-service");

function actor(role: Actor["role"], storeStatus: Actor["storeStatus"] = null): Actor {
  return Object.freeze({
    userId: "user_me",
    role,
    storeId: storeStatus === null ? null : "store_me",
    storeStatus,
  });
}

const SELLER = actor("SELLER", "APPROVED");
const SUSPENDED = actor("SELLER", "SUSPENDED");
const SCOPE = { storeId: "store_me", userId: "user_me" };

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  throw new Error("expected a refusal");
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  lockedStatus = "PENDING";
});

describe("permission checks", () => {
  const ALL: [string, (who: Actor) => Promise<unknown>][] = [
    ["listOwnSellerOrders", (who) => service.listOwnSellerOrders(who, { page: 1, pageSize: 20 })],
    ["getOwnSellerOrder", (who) => service.getOwnSellerOrder(who, "so1")],
    [
      "changeSellerOrderStatus",
      (who) => service.changeSellerOrderStatus(who, "so1", { to: "PROCESSING" }),
    ],
    ["getSellerSummary", (who) => service.getSellerSummary(who)],
  ];

  it.each(ALL)(
    "%s: a customer and an admin are 403 FORBIDDEN before any query",
    async (_n, run) => {
      for (const who of [
        actor("CUSTOMER"),
        actor("ADMIN"),
        { ...actor("ADMIN"), storeId: "store_me" },
      ]) {
        expect(await codeOf(run(who))).toBe("FORBIDDEN");
      }
      expect(calls).toEqual([]);
      for (const fn of Object.values(repo)) expect(fn).not.toHaveBeenCalled();
    },
  );

  it.each(ALL)(
    "%s: an approved and a suspended seller pass, scoped by the session",
    async (_n, run) => {
      for (const who of [SELLER, SUSPENDED]) {
        await run(who);
      }
      const scoped = [
        repo.listOwnPaidSellerOrders,
        repo.findOwnPaidSellerOrder,
        repo.readOwnPaidSellerOrder,
        repo.lockOwnPaidSellerOrder,
        repo.readSellerSummaryRows,
      ].filter((fn) => fn.mock.calls.length > 0);
      expect(scoped.length).toBeGreaterThan(0);
      for (const fn of scoped) {
        for (const args of fn.mock.calls as unknown[][]) {
          expect(args).toContainEqual(SCOPE);
        }
      }
    },
  );

  it.each(ALL)(
    "%s: a SELLER without a store is a fault before any query, not a 404",
    async (_n, run) => {
      const failure = await run(actor("SELLER")).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(AppError);
      expect((failure as Error).message).toBe("orders: a SELLER without a store.");
      expect(calls).toEqual([]);
      for (const fn of Object.values(repo)) expect(fn).not.toHaveBeenCalled();
    },
  );
});

describe("reads", () => {
  it("getOwnSellerOrder reads through the one read-only snapshot, not the pooled client (CR-T043-02)", async () => {
    await service.getOwnSellerOrder(SELLER, "so1");
    expect(repo.readOwnPaidSellerOrder).toHaveBeenCalledTimes(1);
    expect(repo.readOwnPaidSellerOrder).toHaveBeenCalledWith(SCOPE, "so1");
    expect(repo.findOwnPaidSellerOrder).not.toHaveBeenCalled();
    expect(calls).toEqual(["snapshot read"]);
  });

  it("getOwnSellerOrder: not found is 404 NOT_FOUND with empty details", async () => {
    repo.readOwnPaidSellerOrder.mockResolvedValueOnce(null);
    await expect(service.getOwnSellerOrder(SELLER, "other")).rejects.toMatchObject({
      code: "NOT_FOUND",
      details: {},
    });
  });

  it("listOwnSellerOrders passes the filter and the page and maps every row", async () => {
    const page = await service.listOwnSellerOrders(SELLER, {
      page: 2,
      pageSize: 10,
      fulfilmentStatus: "SHIPPED",
    });
    expect(repo.listOwnPaidSellerOrders).toHaveBeenCalledWith(
      SCOPE,
      { fulfilmentStatus: "SHIPPED" },
      { page: 2, pageSize: 10, fulfilmentStatus: "SHIPPED" },
    );
    expect(page).toMatchObject({ page: 2, pageSize: 10, total: 1 });
    expect(page.items[0]?.id).toBe("so1");
  });

  it("listOwnSellerOrders: an entry carries neither paidAt nor shippingAddress (Q42 ruling)", async () => {
    const page = await service.listOwnSellerOrders(SELLER, { page: 1, pageSize: 20 });
    const entry = page.items[0];
    expect(entry).toBeDefined();
    expect(entry).not.toHaveProperty("paidAt");
    expect(entry).not.toHaveProperty("shippingAddress");
    expect(JSON.stringify(page)).not.toContain("0812345678");
  });

  it("getOwnSellerOrder: the detail keeps paidAt and shippingAddress", async () => {
    const dto = await service.getOwnSellerOrder(SELLER, "so1");
    expect(dto.paidAt).toBe("2026-10-20T00:00:01.000Z");
    expect(dto.shippingAddress).toMatchObject({ phone: "0812345678", postalCode: "10110" });
  });

  it("getSellerSummary passes the low-stock threshold", async () => {
    await service.getSellerSummary(SUSPENDED);
    expect(repo.readSellerSummaryRows).toHaveBeenCalledWith(SCOPE, 5);
  });
});

describe("changeSellerOrderStatus", () => {
  it("an unknown, foreign, or unpaid seller order is 404 and nothing moves", async () => {
    lockedStatus = null;
    expect(await codeOf(service.changeSellerOrderStatus(SELLER, "x", { to: "CANCELLED" }))).toBe(
      "NOT_FOUND",
    );
    expect(calls).toEqual(["begin", "lock"]);
  });

  const TARGETS = ["PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"] as const;
  const ALLOWED = new Set([
    "PENDING>PROCESSING",
    "PROCESSING>SHIPPED",
    "SHIPPED>DELIVERED",
    "PENDING>CANCELLED",
    "PROCESSING>CANCELLED",
  ]);
  const PAIRS = FULFILMENT_STATUSES.flatMap((from) => TARGETS.map((to) => [from, to] as const));

  it.each(PAIRS)("%s to %s follows the table for the seller", async (from, to) => {
    lockedStatus = from;
    const run = service.changeSellerOrderStatus(SUSPENDED, "so1", { to });
    if (!ALLOWED.has(`${from}>${to}`)) {
      expect(await codeOf(run)).toBe("INVALID_STATE_TRANSITION");
      expect(calls).toEqual(["begin", "lock"]);
      return;
    }
    await run;
    const effect = {
      PROCESSING: [],
      SHIPPED: ["shipment"],
      DELIVERED: ["delivered"],
      CANCELLED: ["restore"],
    }[to];
    const check = to === "DELIVERED" ? ["eligibility"] : [];
    expect(calls).toEqual(["begin", "lock", ...check, "move", ...effect, "read"]);
    const sources = repo.moveSellerOrderStatus.mock.calls[0] as unknown[];
    expect(sources[4]).toBe(to);
    expect(sources[3]).toContain(from);
  });

  it("SHIPPED to CANCELLED is refused and restores nothing (BR-29)", async () => {
    lockedStatus = "SHIPPED";
    expect(await codeOf(service.changeSellerOrderStatus(SELLER, "so1", { to: "CANCELLED" }))).toBe(
      "INVALID_STATE_TRANSITION",
    );
    expect(repo.claimAndRestoreStock).not.toHaveBeenCalled();
    expect(repo.moveSellerOrderStatus).not.toHaveBeenCalled();
  });

  it("SHIPPED writes the seller-entered carrier and tracking number, or null", async () => {
    lockedStatus = "PROCESSING";
    await service.changeSellerOrderStatus(SELLER, "so1", {
      to: "SHIPPED",
      carrierName: "Kerry",
      trackingNumber: "T1",
    });
    expect(repo.insertShipment).toHaveBeenLastCalledWith({ tx: true }, "so1", "Kerry", "T1");
    await service.changeSellerOrderStatus(SELLER, "so1", { to: "SHIPPED" });
    expect(repo.insertShipment).toHaveBeenLastCalledWith({ tx: true }, "so1", null, null);
  });

  it("a guarded move that changed no row is 409, never a success", async () => {
    repo.moveSellerOrderStatus.mockResolvedValueOnce(false);
    expect(await codeOf(service.changeSellerOrderStatus(SELLER, "so1", { to: "CANCELLED" }))).toBe(
      "INVALID_STATE_TRANSITION",
    );
    expect(repo.claimAndRestoreStock).not.toHaveBeenCalled();
  });

  it("DELIVERED without an undelivered shipment is a fault (rolled back), not a success", async () => {
    lockedStatus = "SHIPPED";
    eligibilityOnce(null);
    await expect(
      service.changeSellerOrderStatus(SELLER, "so1", { to: "DELIVERED" }),
    ).rejects.not.toBeInstanceOf(AppError);
    expect(calls).toEqual(["begin", "lock", "eligibility"]);
  });

  it("a DELIVERED write that changed no row is a fault (rolled back), not a success", async () => {
    lockedStatus = "SHIPPED";
    repo.markShipmentDeliveredBySeller.mockResolvedValueOnce(false);
    await expect(
      service.changeSellerOrderStatus(SELLER, "so1", { to: "DELIVERED" }),
    ).rejects.not.toBeInstanceOf(AppError);
    expect(repo.findOwnPaidSellerOrder).not.toHaveBeenCalled();
  });
});

describe("SEC-072: a seller marks DELIVERED only SELLER_DELIVERY_MIN_HOURS_AFTER_SHIPPED after shippedAt", () => {
  it("the minimum is 24 hours, a named constant of state.ts", () => {
    expect(SELLER_DELIVERY_MIN_HOURS_AFTER_SHIPPED).toBe(24);
  });

  it.each([SELLER, SUSPENDED])(
    "too early is 409 CONFLICT DELIVERY_TOO_EARLY before any write",
    async (who) => {
      lockedStatus = "SHIPPED";
      eligibilityOnce("TOO_EARLY");
      const error = await service.changeSellerOrderStatus(who, "so1", { to: "DELIVERED" }).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).status).toBe(409);
      expect((error as AppError).toPublic()).toMatchObject({
        code: "CONFLICT",
        details: { reason: "DELIVERY_TOO_EARLY" },
      });
      expect(calls).toEqual(["begin", "lock", "eligibility"]);
      expect(repo.moveSellerOrderStatus).not.toHaveBeenCalled();
      expect(repo.markShipmentDeliveredBySeller).not.toHaveBeenCalled();
    },
  );

  it("the check and the guarded write get the constant and the id, never a time from the process", async () => {
    lockedStatus = "SHIPPED";
    await service.changeSellerOrderStatus(SELLER, "so1", { to: "DELIVERED" });
    expect(repo.readSellerDeliveryEligibility).toHaveBeenCalledWith(
      { tx: true },
      "so1",
      SELLER_DELIVERY_MIN_HOURS_AFTER_SHIPPED,
    );
    expect(repo.markShipmentDeliveredBySeller).toHaveBeenCalledWith(
      { tx: true },
      "so1",
      SELLER_DELIVERY_MIN_HOURS_AFTER_SHIPPED,
    );
  });

  it("a move the table refuses is judged first: DELIVERED from PROCESSING is INVALID_STATE_TRANSITION, no age check", async () => {
    lockedStatus = "PROCESSING";
    expect(await codeOf(service.changeSellerOrderStatus(SELLER, "so1", { to: "DELIVERED" }))).toBe(
      "INVALID_STATE_TRANSITION",
    );
    expect(repo.readSellerDeliveryEligibility).not.toHaveBeenCalled();
  });

  it.each(["PROCESSING", "SHIPPED", "CANCELLED"] as const)(
    "the age check runs only for DELIVERED, not for %s",
    async (to) => {
      lockedStatus = to === "SHIPPED" ? "PROCESSING" : "PENDING";
      await service.changeSellerOrderStatus(SELLER, "so1", { to });
      expect(repo.readSellerDeliveryEligibility).not.toHaveBeenCalled();
    },
  );
});
