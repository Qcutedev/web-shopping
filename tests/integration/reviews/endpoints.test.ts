/**
 * T-035: `POST /api/v1/orders/{id}/items/{itemId}/review` against the worker's real test database
 * (docs/API_CONTRACTS.md sections 1.8, 5.6, and 6; REQ-C-14, BR-11).
 *
 * The route module is called in process with a real `Request` and a real session cookie from the
 * sign-in route, so `requireActor` reads the user from the database as in a running server. Each
 * case makes its own users and orders, because the database is emptied once per file, not per
 * case. Covered: success (and the review then appearing in the product's public list and on the
 * order), validation failure, unauthenticated, every role allowed (access `user`), wrong owner
 * (another user's order or an item of another order is 404 and writes nothing), BR-11 refusals
 * (`NOT_DELIVERED` for every other status, `DUPLICATE_REVIEW`), two concurrent reviews of one item,
 * request values that must be ignored, and the rate limit.
 *
 * Orders are written by the `createOrder` graph factory (paid) and moved to `DELIVERED` directly,
 * with the shipment a delivery leaves, because the seller's status endpoint is T-043's subject.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as reviewRoute } from "@/app/api/v1/orders/[id]/items/[itemId]/review/route";
import { GET as orderRoute } from "@/app/api/v1/orders/[id]/route";
import { insertReview, REVIEW_ORDER_ITEM_INDEX } from "@/modules/reviews/repository";
import { db, type FulfilmentStatus, isUniqueIndexViolation } from "@/server/db";

import { createOrder, createProduct } from "../../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../../helpers/snapshot";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import { callProductReviews, type ListBody } from "../catalog/call";
import { request, type CallOptions } from "../inventory/support";
import { errorCode, json, signedIn, type SignedIn } from "../sellers/support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

interface ReviewData {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}

interface ErrorData {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

function params(id: string, itemId: string): never {
  return { params: Promise.resolve({ id, itemId }) } as never;
}

function review(orderId: string, itemId: string, options: CallOptions): Promise<Response> {
  return reviewRoute(
    request("POST", `/api/v1/orders/${orderId}/items/${itemId}/review`, options),
    params(orderId, itemId),
  );
}

async function errorOf(response: Response): Promise<ErrorData> {
  const { error } = await json<{ error: ErrorData & { requestId: string } }>(response);
  return { code: error.code, message: error.message, details: error.details };
}

/** A snapshot of everything but sessions (a request may touch its session row). */
function snapshot() {
  return snapshotDatabase({ excludeTables: ["Session"] });
}

async function expectUnchanged(before: Awaited<ReturnType<typeof snapshot>>): Promise<void> {
  expect(diffSnapshots(before, await snapshot())).toEqual([]);
}

/** Moves a seller order to `status`; `DELIVERED` and `SHIPPED` get the shipment they carry. */
async function setStatus(sellerOrderId: string, status: FulfilmentStatus): Promise<void> {
  await db.sellerOrder.update({
    where: { id: sellerOrderId },
    data: { fulfilmentStatus: status },
  });
  if (status === "SHIPPED" || status === "DELIVERED") {
    const shippedAt = new Date(Date.now() - 60_000);
    await db.shipment.create({
      data: {
        sellerOrderId,
        shippedAt,
        deliveredAt: status === "DELIVERED" ? new Date() : null,
      },
    });
  }
}

/** A paid order of `buyer` with one item per new product, its seller orders at `status`. */
async function orderOf(buyer: SignedIn, status: FulfilmentStatus = "DELIVERED", products = 1) {
  const created = [];
  for (let index = 0; index < products; index += 1) created.push(await createProduct());
  const order = await createOrder({
    userId: buyer.userId,
    lines: created.map((product) => ({ productId: product.id, quantity: 1 })),
  });
  for (const sellerOrder of order.sellerOrders) await setStatus(sellerOrder.id, status);
  return { ...order, products: created, item: order.items[0]! };
}

/** Reviews written by `userId` (the database is shared by every case of this file). */
async function reviewCount(userId: string): Promise<number> {
  return db.review.count({ where: { userId } });
}

describe("POST /api/v1/orders/{id}/items/{itemId}/review: success", () => {
  it("creates the review of a delivered item and answers 201 with its public shape", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { order, item } = await orderOf(buyer);
    const response = await review(order.id, item.id, {
      cookie: buyer.cookie,
      body: { rating: 4, comment: "  ส่งไว\r\nของดี  " },
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { data } = await json<{ data: ReviewData }>(response);
    expect(Object.keys(data).sort()).toEqual(["comment", "createdAt", "id", "rating"]);
    expect(data).toMatchObject({ rating: 4, comment: "ส่งไว\nของดี" });
    expect(data.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    const row = await db.review.findUniqueOrThrow({ where: { id: data.id } });
    expect(row).toMatchObject({
      orderItemId: item.id,
      productId: item.productId,
      userId: buyer.userId,
      rating: 4,
      comment: "ส่งไว\nของดี",
    });
  });

  it("returns markup-like text exactly as stored, in the answer and in the public list", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { order, item, products } = await orderOf(buyer);
    const comment = "<img src=x onerror=alert(1)> & <b>ดี</b>";
    const response = await review(order.id, item.id, {
      cookie: buyer.cookie,
      body: { rating: 5, comment },
    });
    expect(response.status).toBe(201);
    expect((await json<{ data: ReviewData }>(response)).data.comment).toBe(comment);

    const listed = await callProductReviews<ListBody<ReviewData>>(products[0]!.slug);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0]).toMatchObject({ rating: 5, comment });
    expect(JSON.stringify(listed.body)).not.toContain(buyer.userId);
  });

  it("shows the review on the buyer's order item", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { order, item } = await orderOf(buyer);
    const created = await review(order.id, item.id, { cookie: buyer.cookie, body: { rating: 3 } });
    const { data } = await json<{ data: ReviewData }>(created);
    expect(data.comment).toBeNull();

    const read = await orderRoute(
      request("GET", `/api/v1/orders/${order.id}`, { cookie: buyer.cookie }),
      { params: Promise.resolve({ id: order.id }) } as never,
    );
    expect(read.status).toBe(200);
    const body = await json<{
      data: { sellerOrders: { items: { id: string; review: ReviewData | null }[] }[] };
    }>(read);
    expect(body.data.sellerOrders[0]!.items[0]!.review).toEqual(data);
  });

  it("is open to every role that bought the item (access user)", async () => {
    for (const role of ["SELLER", "ADMIN"] as const) {
      const buyer = await signedIn(role);
      const { order, item } = await orderOf(buyer);
      const response = await review(order.id, item.id, {
        cookie: buyer.cookie,
        body: { rating: 5 },
      });
      expect(response.status).toBe(201);
    }
  });

  it("reviews each item of a multi-store order on its own, once each", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { order, items } = await orderOf(buyer, "DELIVERED", 2);
    expect(items).toHaveLength(2);
    for (const item of items) {
      const response = await review(order.id, item.id, {
        cookie: buyer.cookie,
        body: { rating: 2 },
      });
      expect(response.status).toBe(201);
    }
    expect(
      await db.review.count({ where: { orderItem: { sellerOrder: { orderId: order.id } } } }),
    ).toBe(2);
  });

  it("still accepts a review after the product was archived (its order item is untouched)", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { order, item } = await orderOf(buyer);
    await db.product.update({ where: { id: item.productId }, data: { status: "ARCHIVED" } });
    const response = await review(order.id, item.id, { cookie: buyer.cookie, body: { rating: 1 } });
    expect(response.status).toBe(201);
  });
});

describe("POST /api/v1/orders/{id}/items/{itemId}/review: refusals", () => {
  it("is 401 for a guest and writes nothing", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { order, item } = await orderOf(buyer);
    const before = await snapshot();
    const response = await review(order.id, item.id, { body: { rating: 5 } });
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("UNAUTHENTICATED");
    await expectUnchanged(before);
  });

  it("is 403 for a foreign Origin and 415 for a wrong content type", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { order, item } = await orderOf(buyer);
    const foreign = await review(order.id, item.id, {
      cookie: buyer.cookie,
      origin: "https://evil.example",
      body: { rating: 5 },
    });
    expect(foreign.status).toBe(403);
    const mistyped = await review(order.id, item.id, {
      cookie: buyer.cookie,
      contentType: "text/plain",
      body: { rating: 5 },
    });
    expect(mistyped.status).toBe(415);
    expect(await reviewCount(buyer.userId)).toBe(0);
  });

  it("is 400 for an invalid body and writes nothing", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { order, item } = await orderOf(buyer);
    const before = await snapshot();
    const bodies: CallOptions[] = [
      { body: { rating: 0 } },
      { body: { rating: 6 } },
      { body: { rating: 4.5 } },
      { body: { rating: "5" } },
      { body: {} },
      { body: { rating: 5, comment: "x".repeat(2001) } },
      { body: { rating: 5, comment: `bad${String.fromCodePoint(0x202e)}` } },
      { rawBody: "{not json" },
    ];
    for (const options of bodies) {
      const response = await review(order.id, item.id, { cookie: buyer.cookie, ...options });
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("VALIDATION_ERROR");
    }
    await expectUnchanged(before);
  });

  it("refuses productId, userId, and the other ids as unknown keys (400), never using them", async () => {
    const buyer = await signedIn("CUSTOMER");
    const victim = await signedIn("CUSTOMER");
    const { order, item } = await orderOf(buyer);
    const other = await createProduct();
    for (const extra of [
      { productId: other.id },
      { userId: victim.userId },
      { orderItemId: item.id },
      { storeId: other.storeId },
    ]) {
      const response = await review(order.id, item.id, {
        cookie: buyer.cookie,
        body: { rating: 5, ...extra },
      });
      expect(response.status).toBe(400);
      const error = await errorOf(response);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(error.details)).toContain("unrecognized_keys");
    }
    expect(await reviewCount(buyer.userId)).toBe(0);
    expect(await reviewCount(victim.userId)).toBe(0);
  });

  it("is 404 for another user's order, identical to an unknown id, and writes nothing", async () => {
    const owner = await signedIn("CUSTOMER");
    const intruder = await signedIn("CUSTOMER");
    const { order, item } = await orderOf(owner);
    const before = await snapshot();

    const foreign = await review(order.id, item.id, {
      cookie: intruder.cookie,
      body: { rating: 1, comment: "ไม่ดี" },
    });
    expect(foreign.status).toBe(404);
    const unknown = await review("no-such-order", "no-such-item", {
      cookie: intruder.cookie,
      body: { rating: 1 },
    });
    expect(unknown.status).toBe(404);
    const expected = { code: "NOT_FOUND", message: "The resource was not found.", details: {} };
    expect(await errorOf(foreign)).toEqual(expected);
    expect(await errorOf(unknown)).toEqual(expected);
    await expectUnchanged(before);
  });

  it("is 404 for an item of another order, even of the same buyer", async () => {
    const buyer = await signedIn("CUSTOMER");
    const first = await orderOf(buyer);
    const second = await orderOf(buyer);
    const response = await review(first.order.id, second.item.id, {
      cookie: buyer.cookie,
      body: { rating: 5 },
    });
    expect(response.status).toBe(404);
    expect(await reviewCount(buyer.userId)).toBe(0);
  });

  it("is 404 for a seller reviewing an item of their own store sold to someone else", async () => {
    const seller = await signedIn("SELLER");
    const buyer = await signedIn("CUSTOMER");
    const product = await createProduct({ storeId: seller.storeId! });
    const order = await createOrder({
      userId: buyer.userId,
      lines: [{ productId: product.id, quantity: 1 }],
    });
    await setStatus(order.sellerOrders[0]!.id, "DELIVERED");
    const response = await review(order.order.id, order.items[0]!.id, {
      cookie: seller.cookie,
      body: { rating: 5 },
    });
    expect(response.status).toBe(404);
    expect(await db.review.count({ where: { orderItemId: order.items[0]!.id } })).toBe(0);
  });

  it("is 409 NOT_DELIVERED for every status other than DELIVERED (BR-11)", async () => {
    const buyer = await signedIn("CUSTOMER");
    for (const status of ["PENDING", "PROCESSING", "SHIPPED", "CANCELLED"] as const) {
      const { order, item } = await orderOf(buyer, status);
      const before = await snapshot();
      const response = await review(order.id, item.id, {
        cookie: buyer.cookie,
        body: { rating: 5 },
      });
      expect(response.status).toBe(409);
      expect(await errorOf(response)).toEqual({
        code: "CONFLICT",
        message: "The request conflicts with existing data.",
        details: { reason: "NOT_DELIVERED" },
      });
      await expectUnchanged(before);
    }
  });

  it("is 409 NOT_DELIVERED for an unpaid order's item", async () => {
    const buyer = await signedIn("CUSTOMER");
    const product = await createProduct();
    const order = await createOrder({
      userId: buyer.userId,
      paymentStatus: "PENDING",
      lines: [{ productId: product.id, quantity: 1 }],
    });
    const response = await review(order.order.id, order.items[0]!.id, {
      cookie: buyer.cookie,
      body: { rating: 5 },
    });
    expect(response.status).toBe(409);
    expect((await errorOf(response)).details).toEqual({ reason: "NOT_DELIVERED" });
  });

  it("is 409 DUPLICATE_REVIEW for a second review of one item; the first is kept", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { order, item } = await orderOf(buyer);
    const first = await review(order.id, item.id, {
      cookie: buyer.cookie,
      body: { rating: 5, comment: "แรก" },
    });
    expect(first.status).toBe(201);
    const before = await snapshot();
    const second = await review(order.id, item.id, {
      cookie: buyer.cookie,
      body: { rating: 1, comment: "สอง" },
    });
    expect(second.status).toBe(409);
    expect(await errorOf(second)).toEqual({
      code: "CONFLICT",
      message: "The request conflicts with existing data.",
      details: { reason: "DUPLICATE_REVIEW" },
    });
    await expectUnchanged(before);
    const stored = await db.review.findMany({ where: { orderItemId: item.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ rating: 5, comment: "แรก" });
  });

  it("two concurrent reviews of one item: exactly one 201 and one DUPLICATE_REVIEW", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { order, item } = await orderOf(buyer);
    const responses = await Promise.all(
      [5, 1, 3].map((rating) =>
        review(order.id, item.id, { cookie: buyer.cookie, body: { rating } }),
      ),
    );
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 409, 409]);
    for (const response of responses.filter((candidate) => candidate.status === 409)) {
      expect((await errorOf(response)).details).toEqual({ reason: "DUPLICATE_REVIEW" });
    }
    expect(await db.review.count({ where: { orderItemId: item.id } })).toBe(1);
  });

  it("is 429 on the eleventh request in an hour, whatever the outcome of the first ten", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { order, item } = await orderOf(buyer, "PENDING");
    for (let index = 0; index < 10; index += 1) {
      const response = await review(order.id, item.id, {
        cookie: buyer.cookie,
        body: { rating: 5 },
      });
      expect(response.status).toBe(409);
    }
    const limited = await review(order.id, item.id, {
      cookie: buyer.cookie,
      rawBody: "{not json",
    });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await errorCode(limited)).toBe("RATE_LIMITED");
  });
});

describe("the unique backstop of one review per order item", () => {
  it("a second insert for one item is refused by the index the service recognises", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { item } = await orderOf(buyer);
    const data = {
      orderItemId: item.id,
      productId: item.productId,
      userId: buyer.userId,
      rating: 5,
      comment: null,
    };
    await db.$transaction((tx) => insertReview(tx, data));
    let caught: unknown = null;
    try {
      await db.$transaction((tx) => insertReview(tx, { ...data, rating: 1 }));
    } catch (error) {
      caught = error;
    }
    expect(caught).not.toBeNull();
    expect(isUniqueIndexViolation(caught, REVIEW_ORDER_ITEM_INDEX)).toBe(true);
    expect(await db.review.count({ where: { orderItemId: item.id } })).toBe(1);
  });
});
