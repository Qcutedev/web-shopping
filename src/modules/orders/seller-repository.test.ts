/**
 * The seller order reads against a mocked transaction client: the detail runs in one read-only
 * `REPEATABLE READ` snapshot with every statement on that snapshot and none on the pooled client
 * (CR-T043-02), and the `Order` row is read once per shape, with the detail's columns only on the
 * detail (CR-T043-03; owner ruling on Q42). tests/integration/seller-orders runs the same reads
 * against PostgreSQL.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/server/db";

import {
  findOwnPaidSellerOrder,
  listOwnPaidSellerOrders,
  readOwnPaidSellerOrder,
} from "./seller-repository";

vi.mock("@/server/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/db")>();
  return {
    ...original,
    db: {
      $transaction: vi.fn(),
      $executeRaw: vi.fn(),
      sellerOrder: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
      order: { findUnique: vi.fn(), findMany: vi.fn() },
      shipment: { findMany: vi.fn() },
      orderItem: { findMany: vi.fn() },
      upload: { findMany: vi.fn() },
    },
  };
});

const SCOPE = { storeId: "store_me", userId: "user_me" };

const SCALAR = {
  id: "so1",
  orderId: "o1",
  storeName: "S",
  fulfilmentStatus: "SHIPPED",
  itemsSubtotalSatang: 100,
  shippingFeeSatang: 4_000,
  shippingFeeIsSimulated: true,
  commissionRateBps: 500,
};

const ORDER_VIEW = {
  id: "o1",
  orderNumber: "OD1",
  createdAt: new Date("2026-10-20T00:00:00Z"),
  paymentStatus: "PAID",
  paidAt: new Date("2026-10-20T00:00:01Z"),
  shipRecipientName: "r",
  shipPhone: "0812345678",
  shipLine1: "l",
  shipSubdistrict: "s",
  shipDistrict: "d",
  shipProvince: "p",
  shipPostalCode: "10110",
};

const SHIPMENT = {
  sellerOrderId: "so1",
  carrierName: "Kerry",
  trackingNumber: "T1",
  isSimulated: true,
  shippedAt: new Date("2026-10-20T01:00:00Z"),
  deliveredAt: null,
};

const ITEM = {
  id: "i1",
  sellerOrderId: "so1",
  productId: "p1",
  productTitle: "t",
  productSku: "SKU",
  productImageUploadId: "u1",
  unitPriceSatang: 100,
  quantity: 1,
  lineTotalSatang: 100,
};

const steps: string[] = [];

function step<T>(name: string, value: T) {
  return vi.fn(async () => {
    steps.push(name);
    return value;
  });
}

function makeTx() {
  return {
    $executeRaw: vi.fn(async (strings: TemplateStringsArray) => {
      steps.push(`execute ${strings.join("?").trim()}`);
      return 0;
    }),
    sellerOrder: {
      findFirst: step("sellerOrder.findFirst", SCALAR as typeof SCALAR | null),
      findMany: step("sellerOrder.findMany", [SCALAR]),
      count: step("sellerOrder.count", 1),
    },
    order: {
      findUnique: step("order.findUnique", ORDER_VIEW),
      findMany: step("order.findMany", [
        {
          id: ORDER_VIEW.id,
          orderNumber: ORDER_VIEW.orderNumber,
          createdAt: ORDER_VIEW.createdAt,
          paymentStatus: ORDER_VIEW.paymentStatus,
        },
      ]),
    },
    shipment: { findMany: step("shipment.findMany", [SHIPMENT]) },
    orderItem: { findMany: step("orderItem.findMany", [ITEM]) },
    upload: { findMany: step("upload.findMany", [{ id: "u1", storageKey: "key1" }]) },
  };
}

let tx = makeTx();
const transaction = vi.mocked(db.$transaction);

const READ_OPTIONS = { maxWait: 5_000, timeout: 10_000, isolationLevel: "RepeatableRead" };

function pooledCalls(): number {
  const pooled = db as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
  let count = vi.mocked(db.$executeRaw).mock.calls.length;
  for (const model of ["sellerOrder", "order", "shipment", "orderItem", "upload"]) {
    for (const fn of Object.values(pooled[model] ?? {})) count += fn.mock.calls.length;
  }
  return count;
}

beforeEach(() => {
  vi.clearAllMocks();
  steps.length = 0;
  tx = makeTx();
  transaction.mockImplementation((async (run: (client: unknown) => Promise<unknown>) => {
    steps.push("begin");
    return run(tx);
  }) as never);
});

describe("readOwnPaidSellerOrder (CR-T043-02)", () => {
  it("runs every statement in one read-only REPEATABLE READ transaction", async () => {
    const row = await readOwnPaidSellerOrder(SCOPE, "so1");

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0]?.[1]).toEqual(READ_OPTIONS);
    expect(steps).toEqual([
      "begin",
      "execute SET TRANSACTION READ ONLY",
      "sellerOrder.findFirst",
      "order.findUnique",
      "shipment.findMany",
      "orderItem.findMany",
      "upload.findMany",
    ]);
    expect(pooledCalls()).toBe(0);
    expect(row).toMatchObject({
      id: "so1",
      fulfilmentStatus: "SHIPPED",
      order: { orderNumber: "OD1", paidAt: ORDER_VIEW.paidAt, shipPhone: "0812345678" },
      shipment: { carrierName: "Kerry", trackingNumber: "T1" },
      items: [{ id: "i1", imageKey: "key1" }],
    });
    expect(row?.order).not.toHaveProperty("id");
  });

  it("scopes the lookup by the id, the session's store and owner, and a paid order", async () => {
    await readOwnPaidSellerOrder(SCOPE, "so1");
    expect(tx.sellerOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "so1",
          storeId: "store_me",
          store: { is: { ownerId: "user_me" } },
          order: { is: { paymentStatus: "PAID" } },
        },
      }),
    );
  });

  it("is null and reads nothing more when the seller order is not the store's", async () => {
    tx.sellerOrder.findFirst.mockImplementationOnce(async () => {
      steps.push("sellerOrder.findFirst");
      return null;
    });
    expect(await readOwnPaidSellerOrder(SCOPE, "other")).toBeNull();
    expect(steps).toEqual(["begin", "execute SET TRANSACTION READ ONLY", "sellerOrder.findFirst"]);
    expect(pooledCalls()).toBe(0);
  });
});

describe("one Order read per shape (CR-T043-03)", () => {
  it("the detail reads the Order row once, with the paid time and the address", async () => {
    await findOwnPaidSellerOrder(tx as never, SCOPE, "so1");
    expect(tx.order.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.order.findMany).not.toHaveBeenCalled();
    const select = (tx.order.findUnique.mock.calls[0] as unknown[] | undefined)?.[0] as
      { select: Record<string, boolean> } | undefined;
    expect(select?.select).toMatchObject({
      orderNumber: true,
      paymentStatus: true,
      paidAt: true,
      shipRecipientName: true,
      shipPostalCode: true,
    });
  });

  it("a missing Order row is a fault, not a 404", async () => {
    tx.order.findUnique.mockResolvedValueOnce(null as never);
    await expect(findOwnPaidSellerOrder(tx as never, SCOPE, "so1")).rejects.toThrow(
      "orders: a seller order's order row is missing.",
    );
  });

  it("the list reads the Order rows once, without the paid time or the address (Q42)", async () => {
    const { rows, total } = await listOwnPaidSellerOrders(SCOPE, {}, { page: 1, pageSize: 20 });
    expect(total).toBe(1);
    expect(rows).toHaveLength(1);
    expect(tx.order.findMany).toHaveBeenCalledTimes(1);
    expect(tx.order.findUnique).not.toHaveBeenCalled();
    const select = (tx.order.findMany.mock.calls[0] as unknown[] | undefined)?.[0] as
      { select: Record<string, boolean> } | undefined;
    expect(Object.keys(select?.select ?? {}).sort()).toEqual(
      ["createdAt", "id", "orderNumber", "paymentStatus"].sort(),
    );
    expect(rows[0]?.order).toEqual({
      orderNumber: "OD1",
      createdAt: ORDER_VIEW.createdAt,
      paymentStatus: "PAID",
    });
    expect(pooledCalls()).toBe(0);
  });
});
