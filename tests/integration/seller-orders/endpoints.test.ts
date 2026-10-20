/**
 * T-043: `/api/v1/seller/orders/**` and `/api/v1/seller/summary` against the worker's real test
 * database (docs/API_CONTRACTS.md sections 1.8, 3.2, 5.7.3, and 5.7.4; REQ-S-03, REQ-S-07,
 * REQ-S-08, BR-09, BR-14, BR-15, BR-20, BR-21, BR-25, BR-29, BR-33, BR-35, BR-39).
 *
 * The route modules are called in process with a real `Request` and a real session cookie. Each
 * case makes its own users, stores, and orders, because the database is emptied once per file,
 * not per case. For every endpoint: success, validation failure, unauthenticated, wrong role,
 * wrong owner (another store's seller order is 404 and changes nothing), and a suspended store
 * (still reads and fulfils, BR-14). Orders are written by the `createOrder` graph factory (paid
 * or pending); a failed order is failed by the real failure transaction of the orders module.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { failOrderPayment } from "@/modules/orders";
import { db } from "@/server/db";

import { createCategory, createOrder, createProduct } from "../../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../../helpers/snapshot";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import { call, errorCode, json, type SignedIn, signedIn } from "./support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

interface SellerOrderData {
  id: string;
  orderNumber: string;
  createdAt: string;
  paidAt: string;
  paymentStatus: string;
  fulfilmentStatus: string;
  cancellationKind: string | null;
  storeName: string;
  itemsSubtotalSatang: number;
  shippingFeeSatang: number;
  shippingFeeIsSimulated: boolean;
  commissionRateBps: number;
  shippingAddress: Record<string, string>;
  shipment: {
    carrierName: string | null;
    trackingNumber: string | null;
    isSimulated: boolean;
    shippedAt: string;
    deliveredAt: string | null;
  } | null;
  items: {
    id: string;
    productId: string;
    productTitle: string;
    productSku: string;
    image: { key: string; url: string } | null;
    unitPriceSatang: number;
    quantity: number;
    lineTotalSatang: number;
  }[];
}

/** An entry of the list: no `paidAt` and no shipping address (owner ruling on Q42). */
type SellerOrderListData = Omit<SellerOrderData, "paidAt" | "shippingAddress">;

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

interface SummaryData {
  productsByStatus: Record<string, number>;
  lowStockCount: number;
  soldOutCount: number;
  ordersByStatus: Record<string, number>;
  paidSalesTotalSatang: number;
}

async function dataOf(response: Response): Promise<SellerOrderData> {
  return (await json<{ data: SellerOrderData }>(response)).data;
}

/** The error without its request id, so two answers can be compared. */
async function errorOf(
  response: Response,
): Promise<{ code: string; message: string; details: unknown }> {
  const { error } = await json<{
    error: { code: string; message: string; details: unknown; requestId: string };
  }>(response);
  return { code: error.code, message: error.message, details: error.details };
}

/** A snapshot of everything but sessions (a request may touch its session row). */
function snapshot() {
  return snapshotDatabase({ excludeTables: ["Session"] });
}

async function expectUnchanged(before: Awaited<ReturnType<typeof snapshot>>): Promise<void> {
  expect(diffSnapshots(before, await snapshot())).toEqual([]);
}

async function seller(
  status: "APPROVED" | "SUSPENDED" = "APPROVED",
): Promise<SignedIn & { storeId: string }> {
  const who = await signedIn("SELLER", status);
  if (who.storeId === null) throw new Error("a seller without a store");
  return { ...who, storeId: who.storeId };
}

/** A paid order of one piece (or `quantity`) of a new product of each given store. */
async function paidOrder(storeIds: string[], quantity = 1, stock = 10) {
  const products = [];
  for (const storeId of storeIds) {
    products.push(await createProduct({ storeId, stock, priceSatang: 25_900 }));
  }
  const created = await createOrder({
    lines: products.map((product) => ({ productId: product.id, quantity })),
  });
  const sellerOrderOf = (storeId: string) => {
    const found = created.sellerOrders.find((sellerOrder) => sellerOrder.storeId === storeId);
    if (found === undefined) throw new Error("no seller order for the store");
    return found;
  };
  return { ...created, products, sellerOrderOf };
}

async function pendingOrder(storeId: string) {
  const product = await createProduct({ storeId });
  const created = await createOrder({
    paymentStatus: "PENDING",
    lines: [{ productId: product.id, quantity: 1 }],
  });
  return { ...created, product, sellerOrder: created.sellerOrders[0]! };
}

async function failedOrder(storeId: string) {
  const pending = await pendingOrder(storeId);
  expect(await failOrderPayment(pending.order.id, "SIMULATED_DECLINE")).toBe(true);
  return pending;
}

async function stockOf(productId: string): Promise<number> {
  return (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock;
}

async function statusOf(sellerOrderId: string): Promise<string> {
  return (await db.sellerOrder.findUniqueOrThrow({ where: { id: sellerOrderId } }))
    .fulfilmentStatus;
}

async function move(id: string, cookie: string, to: string, extra: Record<string, unknown> = {}) {
  return call.status(id, { cookie, body: { to, ...extra } });
}

// ---------------------------------------------------------------------------------------------
// GET /seller/orders
// ---------------------------------------------------------------------------------------------

describe("GET /api/v1/seller/orders", () => {
  it("lists only the session's store's seller orders of paid orders, newest first", async () => {
    const me = await seller();
    const other = await seller();
    const older = await paidOrder([me.storeId]);
    const both = await paidOrder([me.storeId, other.storeId]);
    await pendingOrder(me.storeId);
    await failedOrder(me.storeId);
    await paidOrder([other.storeId]);

    const response = await call.list(me.cookie, `?storeId=${other.storeId}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await json<{ data: SellerOrderListData[]; meta: Record<string, number> }>(
      response,
    );
    expect(body.meta).toEqual({ page: 1, pageSize: 20, total: 2, totalPages: 1 });
    expect(body.data.map((row) => row.id)).toEqual([
      both.sellerOrderOf(me.storeId).id,
      older.sellerOrderOf(me.storeId).id,
    ]);
    // Only the seller's own portion of the two-store order.
    const portion = body.data[0]!;
    expect(portion.items.map((item) => item.productId)).toEqual([both.products[0]!.id]);
    expect(portion.paymentStatus).toBe("PAID");
    expect(JSON.stringify(body)).not.toMatch(/grandTotal|shippingTotal/);
    expect(JSON.stringify(body)).not.toContain(both.products[1]!.id);
  });

  it("an entry carries neither paidAt nor the shipping address; the detail keeps both (Q42)", async () => {
    const me = await seller();
    const placed = await paidOrder([me.storeId]);
    const id = placed.sellerOrderOf(me.storeId).id;

    const body = await json<{ data: Record<string, unknown>[] }>(await call.list(me.cookie));
    expect(body.data).toHaveLength(1);
    const entry = body.data[0]!;
    expect(Object.keys(entry).sort()).toEqual(LIST_KEYS);
    expect(entry).not.toHaveProperty("paidAt");
    expect(entry).not.toHaveProperty("shippingAddress");
    const text = JSON.stringify(body);
    for (const value of [
      placed.order.paidAt!.toISOString(),
      placed.order.shipRecipientName,
      placed.order.shipPhone,
      placed.order.shipLine1,
    ]) {
      expect(text).not.toContain(value);
    }

    const detail = await dataOf(await call.get(id, me.cookie));
    expect(detail.paidAt).toBe(placed.order.paidAt!.toISOString());
    expect(detail.shippingAddress).toMatchObject({
      recipientName: placed.order.shipRecipientName,
      phone: placed.order.shipPhone,
    });
    // Everything else of the entry equals the detail.
    expect(entry).toEqual(
      Object.fromEntries(
        Object.entries(detail).filter(([key]) => key !== "paidAt" && key !== "shippingAddress"),
      ),
    );
  });

  it("paginates with a capped page size and filters by fulfilment status", async () => {
    const me = await seller();
    const first = await paidOrder([me.storeId]);
    await paidOrder([me.storeId]);
    await paidOrder([me.storeId]);
    await move(first.sellerOrderOf(me.storeId).id, me.cookie, "PROCESSING");

    const page2 = await json<{ data: SellerOrderListData[]; meta: Record<string, number> }>(
      await call.list(me.cookie, "?page=2&pageSize=2"),
    );
    expect(page2.meta).toEqual({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
    expect(page2.data.map((row) => row.id)).toEqual([first.sellerOrderOf(me.storeId).id]);

    const processing = await json<{ data: SellerOrderListData[]; meta: Record<string, number> }>(
      await call.list(me.cookie, "?fulfilmentStatus=PROCESSING"),
    );
    expect(processing.meta.total).toBe(1);
    expect(processing.data[0]?.fulfilmentStatus).toBe("PROCESSING");

    const beyond = await json<{ data: unknown[]; meta: Record<string, number> }>(
      await call.list(me.cookie, "?page=9"),
    );
    expect(beyond).toEqual({ data: [], meta: { page: 9, pageSize: 20, total: 3, totalPages: 1 } });
  });

  it("a suspended store still lists its seller orders (BR-14)", async () => {
    const me = await seller("SUSPENDED");
    const placed = await paidOrder([me.storeId]);
    const body = await json<{ data: SellerOrderListData[] }>(await call.list(me.cookie));
    expect(body.data.map((row) => row.id)).toEqual([placed.sellerOrderOf(me.storeId).id]);
  });

  it("400 for an invalid query; 401 without a session; 403 for a customer and an admin", async () => {
    const me = await seller();
    for (const query of ["?pageSize=51", "?pageSize=0", "?fulfilmentStatus=LOST"]) {
      const response = await call.list(me.cookie, query);
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("VALIDATION_ERROR");
    }
    const anonymous = await call.list(undefined, "?pageSize=51");
    expect(anonymous.status).toBe(401);
    expect(await errorCode(anonymous)).toBe("UNAUTHENTICATED");
    for (const role of ["CUSTOMER", "ADMIN"] as const) {
      const who = await signedIn(role);
      const response = await call.list(who.cookie, "?pageSize=51");
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("FORBIDDEN");
    }
  });
});

// ---------------------------------------------------------------------------------------------
// GET /seller/orders/{id}
// ---------------------------------------------------------------------------------------------

describe("GET /api/v1/seller/orders/{id}", () => {
  it("returns the seller order with the copies taken at purchase and the order's paid time", async () => {
    const me = await seller();
    const store = await db.store.findUniqueOrThrow({ where: { id: me.storeId } });
    const paidAt = new Date("2026-10-11T18:30:00.000Z");
    const product = await createProduct({ storeId: me.storeId, priceSatang: 25_900 });
    const placed = await createOrder({
      lines: [{ productId: product.id, quantity: 3 }],
      paidAt,
    });
    const sellerOrder = placed.sellerOrders[0]!;
    // Later edits never change history (BR-09).
    await db.store.update({ where: { id: me.storeId }, data: { name: "ชื่อใหม่ของร้าน" } });
    await db.product.update({
      where: { id: product.id },
      data: { title: "new", priceSatang: 100 },
    });

    const response = await call.get(sellerOrder.id, me.cookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const data = await dataOf(response);
    expect(Object.keys(data).sort()).toEqual(
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
    expect(data).toMatchObject({
      id: sellerOrder.id,
      orderNumber: placed.order.orderNumber,
      paidAt: "2026-10-11T18:30:00.000Z",
      paymentStatus: "PAID",
      fulfilmentStatus: "PENDING",
      cancellationKind: null,
      storeName: store.name,
      itemsSubtotalSatang: 77_700,
      shippingFeeSatang: sellerOrder.shippingFeeSatang,
      shippingFeeIsSimulated: true,
      commissionRateBps: sellerOrder.commissionRateBps,
      shipment: null,
      shippingAddress: {
        recipientName: placed.order.shipRecipientName,
        phone: placed.order.shipPhone,
        line1: placed.order.shipLine1,
        subdistrict: placed.order.shipSubdistrict,
        district: placed.order.shipDistrict,
        province: placed.order.shipProvince,
        postalCode: placed.order.shipPostalCode,
      },
    });
    expect(data.items).toEqual([
      {
        id: placed.items[0]!.id,
        productId: product.id,
        productTitle: product.title,
        productSku: product.sku,
        image: null,
        unitPriceSatang: 25_900,
        quantity: 3,
        lineTotalSatang: 77_700,
      },
    ]);
  });

  it("each store of one order sees the same paid time (BR-39)", async () => {
    const me = await seller();
    const other = await seller();
    const placed = await paidOrder([me.storeId, other.storeId]);
    const mine = await dataOf(await call.get(placed.sellerOrderOf(me.storeId).id, me.cookie));
    const theirs = await dataOf(
      await call.get(placed.sellerOrderOf(other.storeId).id, other.cookie),
    );
    expect(mine.paidAt).toBe(placed.order.paidAt?.toISOString());
    expect(theirs.paidAt).toBe(mine.paidAt);
  });

  it("another store's, a pending order's, a failed order's, and an unknown id are the same 404", async () => {
    const me = await seller();
    const other = await seller();
    const foreign = await paidOrder([other.storeId]);
    const pending = await pendingOrder(me.storeId);
    const failed = await failedOrder(me.storeId);

    const unknown = await errorOf(await call.get("no-such-seller-order", me.cookie));
    expect(unknown).toEqual({ code: "NOT_FOUND", message: expect.any(String), details: {} });
    for (const id of [
      foreign.sellerOrderOf(other.storeId).id,
      pending.sellerOrder.id,
      failed.sellerOrder.id,
    ]) {
      const response = await call.get(id, me.cookie);
      expect(response.status).toBe(404);
      expect(await errorOf(response)).toEqual(unknown);
    }
  });

  it("a suspended store still reads its seller order (BR-14)", async () => {
    const me = await seller("SUSPENDED");
    const placed = await paidOrder([me.storeId]);
    expect((await call.get(placed.sellerOrderOf(me.storeId).id, me.cookie)).status).toBe(200);
  });

  it("400 for an invalid id; 401 without a session; 403 for a customer and an admin", async () => {
    const me = await seller();
    const placed = await paidOrder([me.storeId]);
    const id = placed.sellerOrderOf(me.storeId).id;
    const tooLong = await call.get("a".repeat(201), me.cookie);
    expect(tooLong.status).toBe(400);
    expect(await errorCode(tooLong)).toBe("VALIDATION_ERROR");
    expect((await call.get(id, undefined)).status).toBe(401);
    for (const role of ["CUSTOMER", "ADMIN"] as const) {
      const who = await signedIn(role);
      const response = await call.get(id, who.cookie);
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("FORBIDDEN");
    }
  });
});

// ---------------------------------------------------------------------------------------------
// POST /seller/orders/{id}/status
// ---------------------------------------------------------------------------------------------

describe("POST /api/v1/seller/orders/{id}/status", () => {
  it("moves PENDING, PROCESSING, SHIPPED (simulated shipment), DELIVERED", async () => {
    const me = await seller();
    const placed = await paidOrder([me.storeId]);
    const id = placed.sellerOrderOf(me.storeId).id;

    const processing = await move(id, me.cookie, "PROCESSING");
    expect(processing.status).toBe(200);
    expect(processing.headers.get("cache-control")).toBe("no-store");
    expect((await dataOf(processing)).fulfilmentStatus).toBe("PROCESSING");

    const shipped = await dataOf(
      await move(id, me.cookie, "SHIPPED", {
        carrierName: "  ไปรษณีย์ไทย ",
        trackingNumber: "EF123456789TH",
      }),
    );
    expect(shipped.fulfilmentStatus).toBe("SHIPPED");
    expect(shipped.shipment).toMatchObject({
      carrierName: "ไปรษณีย์ไทย",
      trackingNumber: "EF123456789TH",
      isSimulated: true,
      deliveredAt: null,
    });

    const delivered = await dataOf(await move(id, me.cookie, "DELIVERED"));
    expect(delivered.fulfilmentStatus).toBe("DELIVERED");
    expect(delivered.shipment?.deliveredAt).not.toBeNull();
    expect(Date.parse(delivered.shipment!.deliveredAt!)).toBeGreaterThanOrEqual(
      Date.parse(delivered.shipment!.shippedAt),
    );
    const rows = await db.shipment.findMany({ where: { sellerOrderId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ isSimulated: true, carrierName: "ไปรษณีย์ไทย" });
    // The stock was not touched by any of the three moves.
    expect(await stockOf(placed.products[0]!.id)).toBe(9);
  });

  it("SHIPPED without a carrier or tracking number stores nulls", async () => {
    const me = await seller();
    const placed = await paidOrder([me.storeId]);
    const id = placed.sellerOrderOf(me.storeId).id;
    await move(id, me.cookie, "PROCESSING");
    const shipped = await dataOf(await move(id, me.cookie, "SHIPPED"));
    expect(shipped.shipment).toMatchObject({ carrierName: null, trackingNumber: null });
  });

  it.each(["PENDING", "PROCESSING"] as const)(
    "cancelling from %s restores the stock once and leaves the payment PAID (BR-21)",
    async (from) => {
      const me = await seller();
      const placed = await paidOrder([me.storeId], 3);
      const id = placed.sellerOrderOf(me.storeId).id;
      const productId = placed.products[0]!.id;
      if (from === "PROCESSING") await move(id, me.cookie, "PROCESSING");
      expect(await stockOf(productId)).toBe(7);

      const cancelled = await dataOf(await move(id, me.cookie, "CANCELLED"));
      expect(cancelled).toMatchObject({
        fulfilmentStatus: "CANCELLED",
        cancellationKind: "REFUND_OUTSIDE_SYSTEM",
        paymentStatus: "PAID",
        paidAt: placed.order.paidAt?.toISOString(),
      });
      expect(await stockOf(productId)).toBe(10);
      const order = await db.order.findUniqueOrThrow({ where: { id: placed.order.id } });
      expect(order.paymentStatus).toBe("PAID");
      expect(order.paidAt?.toISOString()).toBe(placed.order.paidAt?.toISOString());
      const item = await db.orderItem.findUniqueOrThrow({ where: { id: placed.items[0]!.id } });
      expect(item.stockRestoredAt).not.toBeNull();

      // A second cancel is refused and gives nothing back again.
      const before = await snapshot();
      const again = await move(id, me.cookie, "CANCELLED");
      expect(again.status).toBe(409);
      expect(await errorCode(again)).toBe("INVALID_STATE_TRANSITION");
      await expectUnchanged(before);
    },
  );

  it("cancelling one store's part leaves the other store's part and stock alone", async () => {
    const me = await seller();
    const other = await seller();
    const placed = await paidOrder([me.storeId, other.storeId], 2);
    await move(placed.sellerOrderOf(me.storeId).id, me.cookie, "CANCELLED");
    expect(await stockOf(placed.products[0]!.id)).toBe(10);
    expect(await stockOf(placed.products[1]!.id)).toBe(8);
    expect(await statusOf(placed.sellerOrderOf(other.storeId).id)).toBe("PENDING");
  });

  it("a restore is never refused: an archived product above 1,000,000 still gets its stock back", async () => {
    const me = await seller();
    const placed = await paidOrder([me.storeId], 2);
    const productId = placed.products[0]!.id;
    await db.product.update({
      where: { id: productId },
      data: { stock: 1_000_000, status: "ARCHIVED" },
    });
    expect((await move(placed.sellerOrderOf(me.storeId).id, me.cookie, "CANCELLED")).status).toBe(
      200,
    );
    expect(await stockOf(productId)).toBe(1_000_002);
  });

  it.each([
    ["SHIPPED", "CANCELLED"],
    ["SHIPPED", "PROCESSING"],
    ["PENDING", "SHIPPED"],
    ["PENDING", "DELIVERED"],
    ["PROCESSING", "PROCESSING"],
    ["PROCESSING", "DELIVERED"],
    ["DELIVERED", "CANCELLED"],
    ["DELIVERED", "SHIPPED"],
  ] as const)("%s to %s is 409 INVALID_STATE_TRANSITION and changes nothing", async (from, to) => {
    const me = await seller();
    const placed = await paidOrder([me.storeId]);
    const id = placed.sellerOrderOf(me.storeId).id;
    const path = {
      PENDING: [],
      PROCESSING: ["PROCESSING"],
      SHIPPED: ["PROCESSING", "SHIPPED"],
      DELIVERED: ["PROCESSING", "SHIPPED", "DELIVERED"],
    }[from];
    for (const step of path) expect((await move(id, me.cookie, step)).status).toBe(200);
    expect(await statusOf(id)).toBe(from);

    const before = await snapshot();
    const response = await move(id, me.cookie, to);
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toEqual({
      code: "INVALID_STATE_TRANSITION",
      message: expect.any(String),
      details: {},
    });
    await expectUnchanged(before);
  });

  it("another store's, a pending order's, a failed order's, and an unknown seller order: the same 404, nothing changes", async () => {
    const me = await seller();
    const other = await seller();
    const foreign = await paidOrder([other.storeId]);
    const pending = await pendingOrder(me.storeId);
    const failed = await failedOrder(me.storeId);
    const before = await snapshot();
    const unknown = await errorOf(await move("no-such-seller-order", me.cookie, "CANCELLED"));
    expect(unknown).toEqual({ code: "NOT_FOUND", message: expect.any(String), details: {} });
    for (const id of [
      foreign.sellerOrderOf(other.storeId).id,
      pending.sellerOrder.id,
      failed.sellerOrder.id,
    ]) {
      for (const to of ["PROCESSING", "CANCELLED"]) {
        const response = await move(id, me.cookie, to);
        expect(response.status).toBe(404);
        expect(await errorOf(response)).toEqual(unknown);
      }
    }
    await expectUnchanged(before);
  });

  it("a suspended store still fulfils and cancels its seller orders (BR-14)", async () => {
    const me = await seller("SUSPENDED");
    const placed = await paidOrder([me.storeId]);
    const id = placed.sellerOrderOf(me.storeId).id;
    for (const to of ["PROCESSING", "SHIPPED", "DELIVERED"]) {
      expect((await move(id, me.cookie, to)).status).toBe(200);
    }
    const second = await paidOrder([me.storeId]);
    expect((await move(second.sellerOrderOf(me.storeId).id, me.cookie, "CANCELLED")).status).toBe(
      200,
    );
    expect(await stockOf(second.products[0]!.id)).toBe(10);
  });

  it("400 for an invalid body or id, and nothing changes", async () => {
    const me = await seller();
    const placed = await paidOrder([me.storeId]);
    const id = placed.sellerOrderOf(me.storeId).id;
    const before = await snapshot();
    for (const options of [
      { body: { to: "PROCESSING", carrierName: "Kerry" } },
      { body: { to: "CANCELLED", storeId: me.storeId } },
      { body: { to: "PENDING" } },
      { body: { to: "LOST" } },
      { body: {} },
      { rawBody: "{not json" },
    ]) {
      const response = await call.status(id, { cookie: me.cookie, ...options });
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("VALIDATION_ERROR");
    }
    expect((await move("a".repeat(201), me.cookie, "PROCESSING")).status).toBe(400);
    await expectUnchanged(before);
  });

  it("401, 403 for a customer and an admin, 403 for a foreign origin, 415 without JSON; nothing changes", async () => {
    const me = await seller();
    const placed = await paidOrder([me.storeId]);
    const id = placed.sellerOrderOf(me.storeId).id;
    const others = [await signedIn("CUSTOMER"), await signedIn("ADMIN")];
    const before = await snapshot();
    const anonymous = await call.status(id, { body: { to: "CANCELLED" } });
    expect(anonymous.status).toBe(401);
    for (const who of others) {
      const response = await call.status(id, { cookie: who.cookie, rawBody: "{bad" });
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("FORBIDDEN");
    }
    const foreignOrigin = await call.status(id, {
      cookie: me.cookie,
      origin: "https://evil.example",
      body: { to: "CANCELLED" },
    });
    expect(foreignOrigin.status).toBe(403);
    const noJson = await call.status(id, {
      cookie: me.cookie,
      contentType: "text/plain",
      body: { to: "CANCELLED" },
    });
    expect(noJson.status).toBe(415);
    await expectUnchanged(before);
  });

  it("two cancels at the same time: one 200, one 409, the stock is restored once", async () => {
    const me = await seller();
    const placed = await paidOrder([me.storeId], 4);
    const id = placed.sellerOrderOf(me.storeId).id;
    const responses = await Promise.all([
      move(id, me.cookie, "CANCELLED"),
      move(id, me.cookie, "CANCELLED"),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await stockOf(placed.products[0]!.id)).toBe(10);
  });

  it("a cancel and a ship at the same time: exactly one wins", async () => {
    const me = await seller();
    const placed = await paidOrder([me.storeId], 2);
    const id = placed.sellerOrderOf(me.storeId).id;
    await move(id, me.cookie, "PROCESSING");
    const [cancel, ship] = await Promise.all([
      move(id, me.cookie, "CANCELLED"),
      move(id, me.cookie, "SHIPPED"),
    ]);
    expect([cancel.status, ship.status].sort()).toEqual([200, 409]);
    const final = await statusOf(id);
    const shipments = await db.shipment.count({ where: { sellerOrderId: id } });
    const stock = await stockOf(placed.products[0]!.id);
    if (final === "CANCELLED") {
      expect([shipments, stock]).toEqual([0, 10]);
    } else {
      expect(final).toBe("SHIPPED");
      expect([shipments, stock]).toEqual([1, 8]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// GET /seller/summary
// ---------------------------------------------------------------------------------------------

describe("GET /api/v1/seller/summary", () => {
  it("computes every figure from the store's own rows (REQ-S-03)", async () => {
    const me = await seller();
    const other = await seller();
    const inactive = await createCategory({ isActive: false });
    // Products: on sale with stock 5 (low), 6 (not low), 0 (sold out), 1 in an inactive category
    // (still counted, D-028); published but awaiting approval with stock 1 (in neither figure);
    // a draft with stock 0 and an archived product with stock 2 (in neither figure).
    await createProduct({ storeId: me.storeId, stock: 5 });
    await createProduct({ storeId: me.storeId, stock: 6 });
    await createProduct({ storeId: me.storeId, stock: 0 });
    await createProduct({ storeId: me.storeId, stock: 1, categoryId: inactive.id });
    await createProduct({ storeId: me.storeId, stock: 1, moderationStatus: "PENDING" });
    await createProduct({ storeId: me.storeId, stock: 0, status: "DRAFT" });
    await createProduct({ storeId: me.storeId, stock: 2, status: "ARCHIVED" });
    // Another store's rows never count.
    await createProduct({ storeId: other.storeId, stock: 1 });
    await paidOrder([other.storeId]);

    // Orders: two paid (one moved to PROCESSING, 25,900 x 2 and 25,900 x 1), one paid and
    // cancelled, one pending, one failed. Shipping fees are never part of the total.
    const processing = await paidOrder([me.storeId], 2);
    await move(processing.sellerOrderOf(me.storeId).id, me.cookie, "PROCESSING");
    await paidOrder([me.storeId], 1);
    const cancelled = await paidOrder([me.storeId], 1);
    await move(cancelled.sellerOrderOf(me.storeId).id, me.cookie, "CANCELLED");
    await pendingOrder(me.storeId);
    await failedOrder(me.storeId);

    const response = await call.summary(me.cookie, `?storeId=${other.storeId}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { data } = await json<{ data: SummaryData }>(response);
    expect(data).toEqual({
      // 7 own products above, plus the 5 order products (createProduct defaults: on sale, stock
      // 10 less what was bought, restored for the cancelled and the failed order).
      productsByStatus: { DRAFT: 1, PUBLISHED: 10, ARCHIVED: 1 },
      lowStockCount: 2,
      soldOutCount: 1,
      ordersByStatus: { PENDING: 1, PROCESSING: 1, SHIPPED: 0, DELIVERED: 0, CANCELLED: 1 },
      paidSalesTotalSatang: 25_900 * 3,
    });
  });

  it("cancelling a paid seller order lowers the paid sales total by its goods (BR-21)", async () => {
    const me = await seller();
    const placed = await paidOrder([me.storeId], 2);
    const before = await json<{ data: SummaryData }>(await call.summary(me.cookie));
    expect(before.data.paidSalesTotalSatang).toBe(51_800);
    await move(placed.sellerOrderOf(me.storeId).id, me.cookie, "CANCELLED");
    const after = await json<{ data: SummaryData }>(await call.summary(me.cookie));
    expect(after.data.paidSalesTotalSatang).toBe(0);
    expect(after.data.ordersByStatus.CANCELLED).toBe(1);
  });

  it("sends a total above 32 bits exactly (aggregate, section 1.5)", async () => {
    const me = await seller();
    for (let i = 0; i < 3; i += 1) {
      const product = await createProduct({
        storeId: me.storeId,
        priceSatang: 100_000_000,
        stock: 99,
      });
      await createOrder({ lines: [{ productId: product.id, quantity: 9 }] });
    }
    const { data } = await json<{ data: SummaryData }>(await call.summary(me.cookie));
    expect(data.paidSalesTotalSatang).toBe(2_700_000_000);
  });

  it("an empty store has every figure at 0; a suspended store still reads it (BR-14)", async () => {
    const me = await seller("SUSPENDED");
    const response = await call.summary(me.cookie);
    expect(response.status).toBe(200);
    expect((await json<{ data: SummaryData }>(response)).data).toEqual({
      productsByStatus: { DRAFT: 0, PUBLISHED: 0, ARCHIVED: 0 },
      lowStockCount: 0,
      soldOutCount: 0,
      ordersByStatus: { PENDING: 0, PROCESSING: 0, SHIPPED: 0, DELIVERED: 0, CANCELLED: 0 },
      paidSalesTotalSatang: 0,
    });
  });

  it("401 without a session; 403 for a customer and an admin", async () => {
    const anonymous = await call.summary(undefined);
    expect(anonymous.status).toBe(401);
    expect(await errorCode(anonymous)).toBe("UNAUTHENTICATED");
    for (const role of ["CUSTOMER", "ADMIN"] as const) {
      const who = await signedIn(role);
      const response = await call.summary(who.cookie);
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("FORBIDDEN");
    }
  });
});
