/**
 * T-033 (REQ-N-05; TEST_STRATEGY CC-01 to CC-07): races of checkout on a real PostgreSQL.
 * The requests are sent together and the tests check what is stored, never an order of arrival.
 * Each case makes its own users, stores, and products (the database is emptied once per file).
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { checkout } from "@/modules/checkout";
import { failOverdueOrders } from "@/modules/orders";
import type { PaymentProvider } from "@/modules/payments";
import { db } from "@/server/db";

import { createCartItem, createProduct, createStore } from "../../helpers/factories";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import { newKey, postCheckout, readyToBuy, signedIn, type SignedIn } from "./support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

async function stockOf(productId: string): Promise<number> {
  const row = await db.product.findUniqueOrThrow({ where: { id: productId } });
  return row.stock;
}

async function rowsOf(userIds: string[]) {
  const where = { order: { userId: { in: userIds } } };
  return {
    orders: await db.order.count({ where: { userId: { in: userIds } } }),
    sellerOrders: await db.sellerOrder.count({ where }),
    items: await db.orderItem.count({ where: { sellerOrder: where } }),
    payments: await db.payment.count({ where }),
  };
}

function actorOf(user: SignedIn) {
  return { userId: user.userId, role: "CUSTOMER", storeId: null, storeStatus: null } as const;
}

const silent: PaymentProvider = {
  name: "MOCK",
  isSimulated: true,
  charge: () => Promise.reject(new Error("no answer")),
};

/** Buyers with a ready cart each, then all checkouts sent together. */
async function raceBuyers(lines: { productId: string; quantity: number }[], count: number) {
  const users = await Promise.all(Array.from({ length: count }, () => signedIn()));
  const ready = await Promise.all(users.map((user) => readyToBuy(user, lines)));
  const responses = await Promise.all(
    users.map((user, i) =>
      postCheckout(user, { addressId: ready[i]?.addressId, paymentMethod: "MOCK" }),
    ),
  );
  return { users, responses, userIds: users.map((u) => u.userId) };
}

describe("last item (CC-01)", () => {
  it("10 customers buy the last unit at once: one 201, nine 409, stock 0, no stray rows", async () => {
    const product = await createProduct({ stock: 1 });
    const { responses, userIds } = await raceBuyers([{ productId: product.id, quantity: 1 }], 10);
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(9);
    for (const r of responses.filter((x) => x.status === 409)) {
      expect(r.body.error.code).toBe("INSUFFICIENT_STOCK");
    }
    expect(await stockOf(product.id)).toBe(0);
    expect(await rowsOf(userIds)).toEqual({ orders: 1, sellerOrders: 1, items: 1, payments: 1 });
    // The nine losers keep their cart line.
    expect(await db.cartItem.count({ where: { cart: { userId: { in: userIds } } } })).toBe(9);
  });

  it("stock 5, eight customers want 2 each: exactly two orders, stock 1, never negative", async () => {
    const product = await createProduct({ stock: 5 });
    const { responses, userIds } = await raceBuyers([{ productId: product.id, quantity: 2 }], 8);
    expect(responses.filter((r) => r.status === 201)).toHaveLength(2);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(6);
    expect(await stockOf(product.id)).toBe(1);
    expect((await rowsOf(userIds)).orders).toBe(2);
  });
});

describe("duplicate submission (CC-02)", () => {
  it("the same key sent twice in sequence: 201 then 200, one order, one payment, stock taken once", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 10 });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 3 }]);
    const key = newKey();
    const body = { addressId, paymentMethod: "MOCK" };
    const first = await postCheckout(user, body, { key });
    const second = await postCheckout(user, body, { key });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.data.paymentStatus).toBe("PAID");
    expect(await rowsOf([user.userId])).toEqual({
      orders: 1,
      sellerOrders: 1,
      items: 1,
      payments: 1,
    });
    expect(await stockOf(product.id)).toBe(7);
  });

  it("eight parallel requests with one key: one 201, seven 200, one order, stock taken once", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 10 });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 3 }]);
    const key = newKey();
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        postCheckout(user, { addressId, paymentMethod: "MOCK" }, { key }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 201]);
    expect(new Set(responses.map((r) => r.body.data.id)).size).toBe(1);
    expect(await rowsOf([user.userId])).toEqual({
      orders: 1,
      sellerOrders: 1,
      items: 1,
      payments: 1,
    });
    expect(await stockOf(product.id)).toBe(7);
  });

  it("parallel requests with different keys and one cart: one order, the others refused", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 10 });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 3 }]);
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => postCheckout(user, { addressId, paymentMethod: "MOCK" })),
    );
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status !== 201).every((r) => r.status >= 400)).toBe(true);
    expect((await rowsOf([user.userId])).orders).toBe(1);
    expect(await stockOf(product.id)).toBe(7);
  });

  it("two users with the same key do not affect each other", async () => {
    const product = await createProduct({ stock: 10 });
    const a = await signedIn();
    const b = await signedIn();
    const ra = await readyToBuy(a, [{ productId: product.id, quantity: 1 }]);
    const rb = await readyToBuy(b, [{ productId: product.id, quantity: 1 }]);
    const key = newKey();
    const [one, two] = await Promise.all([
      postCheckout(a, { addressId: ra.addressId, paymentMethod: "MOCK" }, { key }),
      postCheckout(b, { addressId: rb.addressId, paymentMethod: "MOCK" }, { key }),
    ]);
    expect([one.status, two.status]).toEqual([201, 201]);
    expect(one.body.data.id).not.toBe(two.body.data.id);
    expect(await stockOf(product.id)).toBe(8);
  });
});

describe("multi-seller carts sharing a product (CC-03)", () => {
  it("opposite line order across two stores, ten users: no deadlock, every stock exact", async () => {
    const storeA = await createStore();
    const storeB = await createStore();
    const p = await createProduct({ storeId: storeA.id, stock: 100 });
    const q = await createProduct({ storeId: storeB.id, stock: 100 });
    const users = await Promise.all(Array.from({ length: 10 }, () => signedIn()));
    const ready: Awaited<ReturnType<typeof readyToBuy>>[] = [];
    for (const [i, user] of users.entries()) {
      const lines =
        i % 2 === 0
          ? [
              { productId: p.id, quantity: 2 },
              { productId: q.id, quantity: 3 },
            ]
          : [
              { productId: q.id, quantity: 3 },
              { productId: p.id, quantity: 2 },
            ];
      ready.push(await readyToBuy(user, lines));
    }
    const responses = await Promise.all(
      users.map((user, i) =>
        postCheckout(user, { addressId: ready[i]?.addressId, paymentMethod: "MOCK" }),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual(Array<number>(10).fill(201));
    expect(await stockOf(p.id)).toBe(100 - 10 * 2);
    expect(await stockOf(q.id)).toBe(100 - 10 * 3);
    expect(await rowsOf(users.map((u) => u.userId))).toEqual({
      orders: 10,
      sellerOrders: 20,
      items: 20,
      payments: 10,
    });
  });

  it("the shared product has one unit: one order wins whole; the loser took nothing from the other store", async () => {
    const storeA = await createStore();
    const storeB = await createStore();
    const shared = await createProduct({ storeId: storeA.id, stock: 1 });
    const other = await createProduct({ storeId: storeB.id, stock: 10 });
    const a = await signedIn();
    const b = await signedIn();
    const ra = await readyToBuy(a, [
      { productId: shared.id, quantity: 1 },
      { productId: other.id, quantity: 1 },
    ]);
    const rb = await readyToBuy(b, [
      { productId: other.id, quantity: 1 },
      { productId: shared.id, quantity: 1 },
    ]);
    const [x, y] = await Promise.all([
      postCheckout(a, { addressId: ra.addressId, paymentMethod: "MOCK" }),
      postCheckout(b, { addressId: rb.addressId, paymentMethod: "MOCK" }),
    ]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    expect(await stockOf(shared.id)).toBe(0);
    expect(await stockOf(other.id)).toBe(9);
    expect(await rowsOf([a.userId, b.userId])).toEqual({
      orders: 1,
      sellerOrders: 2,
      items: 2,
      payments: 1,
    });
  });
});

describe("payment-timeout sweep racing checkout (CC-07)", () => {
  it("a swept order returns the last unit while another customer buys it: never negative, never lost", async () => {
    const product = await createProduct({ stock: 1 });
    const holder = await signedIn();
    const hold = await readyToBuy(holder, [{ productId: product.id, quantity: 1 }]);
    const pending = await checkout(
      actorOf(holder),
      newKey(),
      { addressId: hold.addressId, paymentMethod: "MOCK", mockOutcome: "SUCCESS" },
      { provider: silent },
    );
    expect(pending.order.paymentStatus).toBe("PENDING");
    expect(await stockOf(product.id)).toBe(0);
    await db.$executeRaw`UPDATE "Order" SET "createdAt" = now() - interval '30 minutes' WHERE "id" = ${pending.order.id}`;

    const buyer = await signedIn();
    const buy = await readyToBuy(buyer, [{ productId: product.id, quantity: 1 }]);
    const [swept, bought] = await Promise.all([
      failOverdueOrders(15),
      postCheckout(buyer, { addressId: buy.addressId, paymentMethod: "MOCK" }),
    ]);
    expect(swept).toEqual({ found: 1, failed: 1, errored: 0 });
    expect([201, 409]).toContain(bought.status);
    // One unit existed: with the buyer (0) or back on the shelf (1).
    expect(await stockOf(product.id)).toBe(bought.status === 201 ? 0 : 1);
    const failed = await db.order.findUniqueOrThrow({ where: { id: pending.order.id } });
    expect(failed.paymentStatus).toBe("FAILED");
    const returned = await db.cartItem.findMany({ where: { cart: { userId: holder.userId } } });
    expect(returned.map((l) => l.quantity)).toEqual([1]);
    expect((await rowsOf([buyer.userId])).orders).toBe(bought.status === 201 ? 1 : 0);

    if (bought.status === 409) {
      const retry = await postCheckout(buyer, { addressId: buy.addressId, paymentMethod: "MOCK" });
      expect(retry.status).toBe(201);
      expect(await stockOf(product.id)).toBe(0);
    }
  });

  it("the sweep and the same customer's new checkout: stock and cart agree with one serial order", async () => {
    const product = await createProduct({ stock: 5 });
    const user = await signedIn();
    const { addressId, cartId } = await readyToBuy(user, [{ productId: product.id, quantity: 2 }]);
    const pending = await checkout(
      actorOf(user),
      newKey(),
      { addressId, paymentMethod: "MOCK", mockOutcome: "SUCCESS" },
      { provider: silent },
    );
    await db.$executeRaw`UPDATE "Order" SET "createdAt" = now() - interval '30 minutes' WHERE "id" = ${pending.order.id}`;
    await createCartItem({ cartId, productId: product.id, quantity: 1 });
    const [, second] = await Promise.all([
      failOverdueOrders(15),
      postCheckout(user, { addressId, paymentMethod: "MOCK" }),
    ]);
    expect(second.status).toBe(201);
    const failed = await db.order.findUniqueOrThrow({ where: { id: pending.order.id } });
    expect(failed.paymentStatus).toBe("FAILED");
    // Two serial orders. Checkout first: it buys 1, then the sweep returns 2 (stock 4, cart 2).
    // Sweep first: 2 return and merge with the 1 already in the cart, and checkout buys all 3
    // (stock 2, cart empty). Either way the 3 units are in the new order or in the cart, once.
    const bought = await db.orderItem.findMany({
      where: { sellerOrder: { orderId: second.body.data.id } },
    });
    const ordered = bought.reduce((sum, item) => sum + item.quantity, 0);
    expect([1, 3]).toContain(ordered);
    const lines = await db.cartItem.findMany({ where: { cart: { userId: user.userId } } });
    const left = lines.reduce((sum, l) => sum + l.quantity, 0);
    expect(ordered + left).toBe(3);
    expect(await stockOf(product.id)).toBe(5 - ordered);
  });
});
