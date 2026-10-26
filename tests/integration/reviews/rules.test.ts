/**
 * T-035 QA additions to `endpoints.test.ts`: the value rules of a review (rating bounds, comment
 * limits and normalisation, D-047 item 1) and the visibility rules (D-047 item 2: a delivered item
 * may be reviewed after the product is archived, taken down, or the store suspended; the review is
 * listed publicly only while the product is visible), plus item-level independence inside one
 * order and a parallel burst by the same buyer on several items.
 *
 * Same method as `endpoints.test.ts`: the route module is called in process with a real session
 * cookie; every case builds its own users and orders.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as reviewRoute } from "@/app/api/v1/orders/[id]/items/[itemId]/review/route";
import { db, type FulfilmentStatus } from "@/server/db";

import { createOrder, createProduct } from "../../helpers/factories";
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

function review(orderId: string, itemId: string, options: CallOptions): Promise<Response> {
  return reviewRoute(request("POST", `/api/v1/orders/${orderId}/items/${itemId}/review`, options), {
    params: Promise.resolve({ id: orderId, itemId }),
  } as never);
}

async function setStatus(sellerOrderId: string, status: FulfilmentStatus): Promise<void> {
  await db.sellerOrder.update({
    where: { id: sellerOrderId },
    data: { fulfilmentStatus: status },
  });
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

async function deliveredOrder(buyer: SignedIn, products = 1) {
  const created = [];
  for (let index = 0; index < products; index += 1) created.push(await createProduct());
  const order = await createOrder({
    userId: buyer.userId,
    lines: created.map((product) => ({ productId: product.id, quantity: 1 })),
  });
  for (const sellerOrder of order.sellerOrders) await setStatus(sellerOrder.id, "DELIVERED");
  return { ...order, products: created, item: order.items[0]! };
}

describe("review rating bounds", () => {
  it("accepts the lowest and highest rating (1 and 5)", async () => {
    for (const rating of [1, 5]) {
      const buyer = await signedIn("CUSTOMER");
      const { order, item } = await deliveredOrder(buyer);
      const response = await review(order.id, item.id, { cookie: buyer.cookie, body: { rating } });
      expect(response.status).toBe(201);
      expect((await json<{ data: ReviewData }>(response)).data.rating).toBe(rating);
    }
  });

  it("refuses -1, 0, 6, 100, NaN-like and non-number ratings and stores nothing", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { order, item } = await deliveredOrder(buyer);
    for (const rating of [-1, 0, 6, 100, 1e21, null, true, [5], "five"]) {
      const response = await review(order.id, item.id, { cookie: buyer.cookie, body: { rating } });
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("VALIDATION_ERROR");
    }
    expect(await db.review.count({ where: { orderItemId: item.id } })).toBe(0);
  });
});

describe("review comment rules (D-047 item 1)", () => {
  it("stores an absent, null, empty, or whitespace-only comment as null", async () => {
    const bodies = [
      { rating: 4 },
      { rating: 4, comment: null },
      { rating: 4, comment: "" },
      { rating: 4, comment: "   \r\n \t " },
    ];
    for (const body of bodies) {
      const buyer = await signedIn("CUSTOMER");
      const { order, item } = await deliveredOrder(buyer);
      const response = await review(order.id, item.id, { cookie: buyer.cookie, body });
      expect(response.status).toBe(201);
      expect((await json<{ data: ReviewData }>(response)).data.comment).toBeNull();
      const row = await db.review.findFirstOrThrow({ where: { orderItemId: item.id } });
      expect(row.comment).toBeNull();
    }
  });

  it("accepts a comment of exactly 2000 characters and refuses 2001", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { order, item } = await deliveredOrder(buyer);
    const tooLong = await review(order.id, item.id, {
      cookie: buyer.cookie,
      body: { rating: 5, comment: "ก".repeat(2001) },
    });
    expect(tooLong.status).toBe(400);
    expect(await db.review.count({ where: { orderItemId: item.id } })).toBe(0);

    const exact = await review(order.id, item.id, {
      cookie: buyer.cookie,
      body: { rating: 5, comment: "ก".repeat(2000) },
    });
    expect(exact.status).toBe(201);
    const row = await db.review.findFirstOrThrow({ where: { orderItemId: item.id } });
    expect(row.comment).toHaveLength(2000);
  });

  it("refuses a comment that is not a string", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { order, item } = await deliveredOrder(buyer);
    for (const comment of [5, true, ["a"], { a: 1 }]) {
      const response = await review(order.id, item.id, {
        cookie: buyer.cookie,
        body: { rating: 5, comment },
      });
      expect(response.status).toBe(400);
    }
    expect(await db.review.count({ where: { orderItemId: item.id } })).toBe(0);
  });

  it("refuses NUL and control characters in a comment", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { order, item } = await deliveredOrder(buyer);
    for (const comment of ["a\u0000b", "a\u0007b"]) {
      const response = await review(order.id, item.id, {
        cookie: buyer.cookie,
        body: { rating: 5, comment },
      });
      expect(response.status).toBe(400);
    }
    expect(await db.review.count({ where: { orderItemId: item.id } })).toBe(0);
  });

  it("keeps inner line breaks and trims trailing space of each line", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { order, item } = await deliveredOrder(buyer);
    const response = await review(order.id, item.id, {
      cookie: buyer.cookie,
      body: { rating: 5, comment: "บรรทัดหนึ่ง   \r\nบรรทัดสอง" },
    });
    expect(response.status).toBe(201);
    expect((await json<{ data: ReviewData }>(response)).data.comment).toBe(
      "บรรทัดหนึ่ง\nบรรทัดสอง",
    );
  });
});

describe("review visibility rules (D-047 item 2)", () => {
  it("accepts a review after the product is taken down, and hides it from the public list", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { order, item, products } = await deliveredOrder(buyer);
    const visible = await callProductReviews<ListBody<ReviewData>>(products[0]!.slug);
    expect(visible.status).toBe(200);

    await db.product.update({
      where: { id: item.productId },
      data: { moderationStatus: "TAKEN_DOWN" },
    });
    const response = await review(order.id, item.id, { cookie: buyer.cookie, body: { rating: 4 } });
    expect(response.status).toBe(201);
    const hidden = await callProductReviews<ListBody<ReviewData>>(products[0]!.slug);
    expect(hidden.status).toBe(404);
    expect(await db.review.count({ where: { orderItemId: item.id } })).toBe(1);
  });

  it("accepts a review after the store is suspended, and hides it from the public list", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { order, item, products } = await deliveredOrder(buyer);
    await db.store.update({ where: { id: products[0]!.storeId }, data: { status: "SUSPENDED" } });
    const response = await review(order.id, item.id, { cookie: buyer.cookie, body: { rating: 2 } });
    expect(response.status).toBe(201);
    const hidden = await callProductReviews<ListBody<ReviewData>>(products[0]!.slug);
    expect(hidden.status).toBe(404);
  });

  it("lists the review again once the product is visible", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { order, item, products } = await deliveredOrder(buyer);
    await db.product.update({ where: { id: item.productId }, data: { status: "ARCHIVED" } });
    const response = await review(order.id, item.id, {
      cookie: buyer.cookie,
      body: { rating: 3, comment: "กลับมาแล้ว" },
    });
    expect(response.status).toBe(201);
    await db.product.update({ where: { id: item.productId }, data: { status: "PUBLISHED" } });
    const listed = await callProductReviews<ListBody<ReviewData>>(products[0]!.slug);
    expect(listed.status).toBe(200);
    expect(listed.body.data.map((entry) => entry.comment)).toEqual(["กลับมาแล้ว"]);
  });
});

describe("item-level eligibility inside one order", () => {
  it("allows the delivered seller order's item while the other store's item is still shipped", async () => {
    const buyer = await signedIn("CUSTOMER");
    const first = await createProduct();
    const second = await createProduct();
    const made = await createOrder({
      userId: buyer.userId,
      lines: [
        { productId: first.id, quantity: 1 },
        { productId: second.id, quantity: 1 },
      ],
    });
    expect(made.sellerOrders).toHaveLength(2);
    const deliveredItem = made.items.find((item) => item.productId === first.id)!;
    const shippedItem = made.items.find((item) => item.productId === second.id)!;
    const deliveredOrderId = made.sellerOrders.find((so) => so.storeId === first.storeId)!.id;
    const shippedOrderId = made.sellerOrders.find((so) => so.storeId === second.storeId)!.id;
    await setStatus(deliveredOrderId, "DELIVERED");
    await setStatus(shippedOrderId, "SHIPPED");

    const ok = await review(made.order.id, deliveredItem.id, {
      cookie: buyer.cookie,
      body: { rating: 5 },
    });
    expect(ok.status).toBe(201);
    const refused = await review(made.order.id, shippedItem.id, {
      cookie: buyer.cookie,
      body: { rating: 5 },
    });
    expect(refused.status).toBe(409);
    expect(await db.review.count({ where: { orderItemId: shippedItem.id } })).toBe(0);
  });

  it("parallel reviews of different items of one buyer all succeed, one per item", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { order, items } = await deliveredOrder(buyer, 3);
    const responses = await Promise.all(
      items.map((item) => review(order.id, item.id, { cookie: buyer.cookie, body: { rating: 4 } })),
    );
    expect(responses.map((response) => response.status)).toEqual([201, 201, 201]);
    expect(
      await db.review.count({ where: { orderItem: { sellerOrder: { orderId: order.id } } } }),
    ).toBe(3);
  });

  it("five parallel duplicates after a first review leave the first review untouched", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { order, item } = await deliveredOrder(buyer);
    await review(order.id, item.id, { cookie: buyer.cookie, body: { rating: 5 } });
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        review(order.id, item.id, { cookie: buyer.cookie, body: { rating: 1 } }),
      ),
    );
    expect(responses.every((response) => response.status === 409)).toBe(true);
    const rows = await db.review.findMany({ where: { productId: item.productId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rating).toBe(5);
  });
});
