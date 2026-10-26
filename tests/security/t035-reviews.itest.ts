/**
 * Security review of T-035 (review create endpoint), commits 589eef4..3b73244, 2026-10-26. Owner:
 * security. Review: docs/reviews/T-035-security.md. Real PostgreSQL (`pnpm test:integration`).
 *
 * Independent of the author's tests/integration/reviews/endpoints.test.ts. Covered here:
 *
 *   1. IDOR matrix: another customer, the seller who sold the item, and an admin get 404 for the
 *      buyer's order; mixing an order id with an item id of another order (own or foreign) is 404;
 *      every refusal writes nothing;
 *   2. BR-11 per seller order: in one order with two stores, only the delivered store's item can
 *      be reviewed;
 *   3. one review per item under a burst of parallel requests from the same buyer;
 *   4. a deactivated buyer's cookie and a foreign Origin are refused before any write;
 *   5. the rate limit is per user and does not spill to another user;
 *   6. D-047 (2): a review of an archived product is accepted but not listed publicly.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as reviewRoute } from "@/app/api/v1/orders/[id]/items/[itemId]/review/route";
import { db, type FulfilmentStatus } from "@/server/db";

import { createOrder, createProduct, createStore } from "../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../helpers/snapshot";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../integration/auth/support";
import { callProductReviews, type ListBody } from "../integration/catalog/call";
import { request, type CallOptions } from "../integration/inventory/support";
import { errorCode, json, signedIn, type SignedIn } from "../integration/sellers/support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

function post(orderId: string, itemId: string, options: CallOptions): Promise<Response> {
  return reviewRoute(request("POST", `/api/v1/orders/${orderId}/items/${itemId}/review`, options), {
    params: Promise.resolve({ id: orderId, itemId }),
  } as never);
}

function snapshot() {
  return snapshotDatabase({ excludeTables: ["Session"] });
}

async function setStatus(sellerOrderId: string, status: FulfilmentStatus): Promise<void> {
  await db.sellerOrder.update({ where: { id: sellerOrderId }, data: { fulfilmentStatus: status } });
  if (status === "SHIPPED" || status === "DELIVERED") {
    await db.shipment.create({
      data: {
        sellerOrderId,
        shippedAt: new Date(Date.now() - 60_000),
        deliveredAt: status === "DELIVERED" ? new Date() : null,
      },
    });
  }
}

/** A paid order of `buyer` with one product of `storeId` (a new store when not given), delivered. */
async function deliveredOrder(buyer: SignedIn, storeId?: string) {
  const product = await createProduct(storeId === undefined ? {} : { storeId });
  const built = await createOrder({
    userId: buyer.userId,
    lines: [{ productId: product.id, quantity: 1 }],
  });
  for (const sellerOrder of built.sellerOrders) await setStatus(sellerOrder.id, "DELIVERED");
  const item = built.items[0];
  if (item === undefined) throw new Error("no item");
  return { order: built.order, item, product };
}

describe("T-035 security: no IDOR on the review target", () => {
  it("another customer, the selling seller, and an admin get 404 for the buyer's delivered item, and nothing is written", async () => {
    const seller = await signedIn("SELLER");
    if (seller.storeId === null) throw new Error("seller without store");
    const buyer = await signedIn("CUSTOMER");
    const { order, item } = await deliveredOrder(buyer, seller.storeId);
    const others = [await signedIn("CUSTOMER"), seller, await signedIn("ADMIN")];

    const before = await snapshot();
    for (const other of others) {
      const response = await post(order.id, item.id, {
        cookie: other.cookie,
        body: { rating: 1, comment: "fake" },
      });
      expect(response.status).toBe(404);
      const { error } = await json<{ error: { code: string; details: unknown } }>(response);
      expect(error).toMatchObject({ code: "NOT_FOUND", details: {} });
    }
    expect(diffSnapshots(before, await snapshot())).toEqual([]);

    // The real buyer still can.
    const own = await post(order.id, item.id, { cookie: buyer.cookie, body: { rating: 5 } });
    expect(own.status).toBe(201);
  });

  it("an order id paired with an item of another order is 404: own order + foreign item, foreign order + own item, own order + own item of another order", async () => {
    const a = await signedIn("CUSTOMER");
    const b = await signedIn("CUSTOMER");
    const a1 = await deliveredOrder(a);
    const a2 = await deliveredOrder(a);
    const b1 = await deliveredOrder(b);

    const before = await snapshot();
    const pairs: [SignedIn, string, string][] = [
      [a, a1.order.id, b1.item.id],
      [a, b1.order.id, a1.item.id],
      [a, a1.order.id, a2.item.id],
      [b, a1.order.id, b1.item.id],
    ];
    for (const [who, orderId, itemId] of pairs) {
      const response = await post(orderId, itemId, { cookie: who.cookie, body: { rating: 2 } });
      expect(response.status, `${orderId}/${itemId}`).toBe(404);
    }
    expect(diffSnapshots(before, await snapshot())).toEqual([]);
  });

  it("the stored review names the session's user and the item's product whatever the path or body claim", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { order, item } = await deliveredOrder(buyer);
    const extra = await post(order.id, item.id, {
      cookie: buyer.cookie,
      body: { rating: 5, productId: "other", userId: "other" },
    });
    expect(extra.status).toBe(400);
    expect(await db.review.count({ where: { orderItemId: item.id } })).toBe(0);

    const ok = await post(order.id, item.id, { cookie: buyer.cookie, body: { rating: 5 } });
    expect(ok.status).toBe(201);
    const row = await db.review.findUniqueOrThrow({ where: { orderItemId: item.id } });
    expect(row.userId).toBe(buyer.userId);
    expect(row.productId).toBe(item.productId);
  });
});

describe("T-035 security: BR-11 is judged per seller order", () => {
  it("one order, two stores: the delivered store's item can be reviewed, the shipped store's item cannot", async () => {
    const buyer = await signedIn("CUSTOMER");
    const storeX = await createStore();
    const storeY = await createStore();
    const productX = await createProduct({ storeId: storeX.id });
    const productY = await createProduct({ storeId: storeY.id });
    const built = await createOrder({
      userId: buyer.userId,
      lines: [
        { productId: productX.id, quantity: 1 },
        { productId: productY.id, quantity: 1 },
      ],
    });
    const soX = built.sellerOrders.find((so) => so.storeId === storeX.id);
    const soY = built.sellerOrders.find((so) => so.storeId === storeY.id);
    if (soX === undefined || soY === undefined) throw new Error("seller orders missing");
    await setStatus(soX.id, "DELIVERED");
    await setStatus(soY.id, "SHIPPED");
    const itemX = built.items.find((item) => item.productId === productX.id);
    const itemY = built.items.find((item) => item.productId === productY.id);
    if (itemX === undefined || itemY === undefined) throw new Error("items missing");

    const refused = await post(built.order.id, itemY.id, {
      cookie: buyer.cookie,
      body: { rating: 1 },
    });
    expect(refused.status).toBe(409);
    expect(
      (await json<{ error: { details: { reason: string } } }>(refused)).error.details.reason,
    ).toBe("NOT_DELIVERED");
    const accepted = await post(built.order.id, itemX.id, {
      cookie: buyer.cookie,
      body: { rating: 5 },
    });
    expect(accepted.status).toBe(201);
    expect(await db.review.count({ where: { orderItemId: itemY.id } })).toBe(0);
  });
});

describe("T-035 security: one review per item under concurrency", () => {
  it("eight parallel requests for one item: exactly one 201, the rest 409 DUPLICATE_REVIEW, one row", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { order, item } = await deliveredOrder(buyer);
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, n) =>
        post(order.id, item.id, { cookie: buyer.cookie, body: { rating: (n % 5) + 1 } }),
      ),
    );
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(7);
    for (const response of responses.filter((r) => r.status === 409)) {
      const { error } = await json<{ error: { details: { reason: string } } }>(response);
      expect(error.details.reason).toBe("DUPLICATE_REVIEW");
    }
    expect(await db.review.count({ where: { orderItemId: item.id } })).toBe(1);
  });
});

describe("T-035 security: refusals before any write", () => {
  it("a deactivated buyer's existing cookie is 401 and writes nothing", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { order, item } = await deliveredOrder(buyer);
    await db.user.update({ where: { id: buyer.userId }, data: { isActive: false } });
    const before = await snapshot();
    const response = await post(order.id, item.id, { cookie: buyer.cookie, body: { rating: 5 } });
    expect(response.status).toBe(401);
    expect(diffSnapshots(before, await snapshot())).toEqual([]);
  });

  it("a foreign Origin or no Origin with the buyer's cookie is 403 and writes nothing", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { order, item } = await deliveredOrder(buyer);
    const before = await snapshot();
    for (const origin of ["https://evil.example", null, "null"]) {
      const response = await post(order.id, item.id, {
        cookie: buyer.cookie,
        origin,
        body: { rating: 5 },
      });
      expect(response.status, String(origin)).toBe(403);
      expect(await errorCode(response)).toBe("FORBIDDEN");
    }
    expect(diffSnapshots(before, await snapshot())).toEqual([]);
  });

  it("the review-create limit is per user: the eleventh request in the hour is 429, another user is unaffected", async () => {
    const a = await signedIn("CUSTOMER");
    const b = await signedIn("CUSTOMER");
    const { order, item } = await deliveredOrder(b);
    for (let n = 0; n < 10; n += 1) {
      const response = await post("missing", "missing", { cookie: a.cookie, body: { rating: 5 } });
      expect(response.status).toBe(404);
    }
    const limited = await post("missing", "missing", { cookie: a.cookie, body: { rating: 5 } });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    const other = await post(order.id, item.id, { cookie: b.cookie, body: { rating: 5 } });
    expect(other.status).toBe(201);
  });
});

describe("T-035 security: D-047 (2), a hidden product", () => {
  it("a review of an archived product is accepted and is not listed publicly", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { order, item, product } = await deliveredOrder(buyer);
    await db.product.update({ where: { id: product.id }, data: { status: "ARCHIVED" } });
    const response = await post(order.id, item.id, {
      cookie: buyer.cookie,
      body: { rating: 1, comment: "hidden" },
    });
    expect(response.status).toBe(201);
    const listed = await callProductReviews<ListBody<unknown>>(product.slug);
    expect(listed.status).toBe(404);
    expect(JSON.stringify(listed.body)).not.toContain("hidden");
  });
});
