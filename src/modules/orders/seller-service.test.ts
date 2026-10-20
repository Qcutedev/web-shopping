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
import { FULFILMENT_STATUSES, type FulfilmentStatusValue } from "./state";

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
  markShipmentDelivered: vi.fn(async () => {
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
      markShipmentDelivered: 0,
      claimAndRestoreStock: 0,
      findOwnPaidSellerOrder: 0,
      listOwnPaidSellerOrders: 0,
      readSellerSummaryRows: 0,
    }).map((name) => [
      name,
      (...args: unknown[]) =>
        (repo as Record<string, (...a: unknown[]) => unknown>)[name]?.(...args),
    ]),
  ),
}));

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

  it("a SELLER without a store is a fault, not a 404", async () => {
    await expect(service.getOwnSellerOrder(actor("SELLER"), "so1")).rejects.not.toBeInstanceOf(
      AppError,
    );
  });
});

describe("reads", () => {
  it("getOwnSellerOrder: not found is 404 NOT_FOUND with empty details", async () => {
    repo.findOwnPaidSellerOrder.mockResolvedValueOnce(null);
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
    expect(calls).toEqual(["begin", "lock", "move", ...effect, "read"]);
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
    repo.markShipmentDelivered.mockResolvedValueOnce(false);
    await expect(
      service.changeSellerOrderStatus(SELLER, "so1", { to: "DELIVERED" }),
    ).rejects.not.toBeInstanceOf(AppError);
  });
});
