/**
 * T-033, the concurrency cases that `races.test.ts` and the cart tests did not cover
 * (docs/TEST_STRATEGY.md "Concurrency tests"): CC-04, CC-05 (full), CC-06 (seller side), CC-07
 * (two parallel sweeps, no second charge on a replay), CC-10, CC-11, CC-14.
 *
 * Not here, because the code they need does not exist yet: the admin cancel (CC-06 admin half and
 * CC-08), the admin deactivation (CC-09), and the admin approval of a product (CC-13).
 *
 * The requests are sent together and the tests check what is stored, never an order of arrival.
 * Each case makes its own users, stores, and products (the database is emptied once per file).
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { checkout } from "@/modules/checkout";
import { changeStock } from "@/modules/inventory";
import { failOrderPayment, failOverdueOrders } from "@/modules/orders";
import type { PaymentProvider } from "@/modules/payments";
import type { Actor } from "@/server/auth/actor";
import { db } from "@/server/db";

import { createProduct } from "../../helpers/factories";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import { call as productCall } from "../inventory/support";
import { call as sellerOrderCall } from "../seller-orders/support";
import { errorCode, signedIn as signedInAs } from "../sellers/support";
import { newKey, postCheckout, readyToBuy, signedIn, type SignedIn } from "./support";

/** Repeats of each race, so a lost race is likely to show at least once. */
const REPEATS = 6;

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

async function stockOf(productId: string): Promise<number> {
  return (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock;
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

function customerActor(user: SignedIn): Actor {
  return { userId: user.userId, role: "CUSTOMER", storeId: null, storeStatus: null };
}

function sellerActor(who: { userId: string; storeId: string }): Actor {
  return { userId: who.userId, role: "SELLER", storeId: who.storeId, storeStatus: "APPROVED" };
}

/** A provider that never answers and counts how often it was asked to charge. */
function silentProvider(): PaymentProvider & { calls: number } {
  const provider = {
    name: "MOCK" as const,
    isSimulated: true as const,
    calls: 0,
    charge: () => {
      provider.calls += 1;
      return Promise.reject(new Error("no answer"));
    },
  };
  return provider;
}

async function overdue(orderId: string): Promise<void> {
  await db.$executeRaw`UPDATE "Order" SET "createdAt" = now() - interval '30 minutes' WHERE "id" = ${orderId}`;
}

// ---------------------------------------------------------------------------------------------
// CC-04
// ---------------------------------------------------------------------------------------------

describe("CC-04: one key in parallel while the cart holds the last units", () => {
  it.each(Array.from({ length: REPEATS }, (_, i) => i + 1))(
    "run %i: stock equals the cart quantity; every response is the one order, none is a conflict",
    async () => {
      const user = await signedIn();
      const product = await createProduct({ stock: 3 });
      const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 3 }]);
      const key = newKey();
      const responses = await Promise.all(
        Array.from({ length: 6 }, () =>
          postCheckout(user, { addressId, paymentMethod: "MOCK" }, { key }),
        ),
      );
      expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 201]);
      expect(responses.some((r) => r.body.error !== undefined)).toBe(false);
      expect(new Set(responses.map((r) => r.body.data.id)).size).toBe(1);
      expect(await stockOf(product.id)).toBe(0);
      expect(await rowsOf([user.userId])).toEqual({
        orders: 1,
        sellerOrders: 1,
        items: 1,
        payments: 1,
      });
      expect(await db.cartItem.count({ where: { cart: { userId: user.userId } } })).toBe(0);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// CC-05
// ---------------------------------------------------------------------------------------------

describe("CC-05: different keys on one cart", () => {
  it("in parallel: one 201, the rest 409 CART_EMPTY, stock taken once, one payment", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 10 });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 3 }]);
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => postCheckout(user, { addressId, paymentMethod: "MOCK" })),
    );
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    const others = responses.filter((r) => r.status !== 201);
    expect(others).toHaveLength(4);
    for (const r of others) {
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe("CART_EMPTY");
    }
    expect(await stockOf(product.id)).toBe(7);
    expect(await rowsOf([user.userId])).toEqual({
      orders: 1,
      sellerOrders: 1,
      items: 1,
      payments: 1,
    });
  });

  it("one after the other: the second key is 409 CART_EMPTY and changes nothing", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 10 });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 3 }]);
    const first = await postCheckout(user, { addressId, paymentMethod: "MOCK" });
    const second = await postCheckout(user, { addressId, paymentMethod: "MOCK" });
    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("CART_EMPTY");
    expect(await stockOf(product.id)).toBe(7);
    expect(await rowsOf([user.userId])).toEqual({
      orders: 1,
      sellerOrders: 1,
      items: 1,
      payments: 1,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// CC-06 (the seller side; the admin cancel does not exist yet)
// ---------------------------------------------------------------------------------------------

describe("CC-06: seller cancel around a failed payment", () => {
  async function twoStoreOrder() {
    const sellerA = await signedInAs("SELLER");
    const sellerB = await signedInAs("SELLER");
    if (sellerA.storeId === null || sellerB.storeId === null) throw new Error("stores expected");
    const a = await createProduct({ storeId: sellerA.storeId, stock: 10 });
    const b = await createProduct({ storeId: sellerB.storeId, stock: 10 });
    const buyer = await signedIn();
    const { addressId } = await readyToBuy(buyer, [
      { productId: a.id, quantity: 2 },
      { productId: b.id, quantity: 3 },
    ]);
    const pending = await checkout(
      customerActor(buyer),
      newKey(),
      { addressId, paymentMethod: "MOCK", mockOutcome: "SUCCESS" },
      { provider: silentProvider() },
    );
    expect(pending.order.paymentStatus).toBe("PENDING");
    const sellerOrders = await db.sellerOrder.findMany({ where: { orderId: pending.order.id } });
    const idOf = (storeId: string | null) =>
      sellerOrders.find((s) => s.storeId === storeId)?.id ?? "";
    return {
      sellerA,
      sellerB,
      a,
      b,
      buyer,
      orderId: pending.order.id,
      sellerOrderA: idOf(sellerA.storeId),
      sellerOrderB: idOf(sellerB.storeId),
    };
  }

  async function cancel(sellerOrderId: string, cookie: string) {
    return sellerOrderCall.status(sellerOrderId, { cookie, body: { to: "CANCELLED" } });
  }

  async function expectRestoredOnce(s: Awaited<ReturnType<typeof twoStoreOrder>>) {
    expect(await stockOf(s.a.id)).toBe(10);
    expect(await stockOf(s.b.id)).toBe(10);
    const items = await db.orderItem.findMany({ where: { sellerOrder: { orderId: s.orderId } } });
    expect(items).toHaveLength(2);
    for (const item of items) expect(item.stockRestoredAt).not.toBeNull();
    const lines = await db.cartItem.findMany({
      where: { cart: { userId: s.buyer.userId } },
      orderBy: { quantity: "asc" },
    });
    expect(lines.map((l) => l.quantity)).toEqual([2, 3]);
    const order = await db.order.findUniqueOrThrow({ where: { id: s.orderId } });
    expect(order.paymentStatus).toBe("FAILED");
    const parts = await db.sellerOrder.findMany({ where: { orderId: s.orderId } });
    expect(parts.map((p) => p.fulfilmentStatus)).toEqual(["CANCELLED", "CANCELLED"]);
  }

  it("after the failure: both sellers get 404, stock stays at its start, nothing restored twice", async () => {
    const s = await twoStoreOrder();
    expect(await failOrderPayment(s.orderId, "SIMULATED_DECLINE")).toBe(true);
    for (const [id, who] of [
      [s.sellerOrderA, s.sellerA],
      [s.sellerOrderB, s.sellerB],
    ] as const) {
      const response = await cancel(id, who.cookie);
      expect(response.status).toBe(404);
      expect(await errorCode(response)).toBe("NOT_FOUND");
    }
    // A second failure and a sweep are no-ops too.
    expect(await failOrderPayment(s.orderId, "SIMULATED_DECLINE")).toBe(false);
    await expectRestoredOnce(s);
  });

  it.each(Array.from({ length: REPEATS }, (_, i) => i + 1))(
    "run %i: in parallel with the failure, the cancels are 404 (the order is never paid), stock restored once",
    async () => {
      const s = await twoStoreOrder();
      const [failed, cancelA, cancelB] = await Promise.all([
        failOrderPayment(s.orderId, "SIMULATED_DECLINE"),
        cancel(s.sellerOrderA, s.sellerA.cookie),
        cancel(s.sellerOrderB, s.sellerB.cookie),
      ]);
      expect(failed).toBe(true);
      expect(cancelA.status).toBe(404);
      expect(cancelB.status).toBe(404);
      await expectRestoredOnce(s);
      expect(await cancel(s.sellerOrderA, s.sellerA.cookie).then((r) => r.status)).toBe(404);
      await expectRestoredOnce(s);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// CC-07 (the two parts that were open)
// ---------------------------------------------------------------------------------------------

describe("CC-07: the provider never answered", () => {
  it("a replay with the same key returns the PENDING order and does not charge again", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 5 });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 2 }]);
    const provider = silentProvider();
    const key = newKey();
    const input = { addressId, paymentMethod: "MOCK", mockOutcome: "SUCCESS" } as const;
    const first = await checkout(customerActor(user), key, input, { provider });
    expect(first.created).toBe(true);
    expect(provider.calls).toBe(1);
    const replays = await Promise.all([
      checkout(customerActor(user), key, input, { provider }),
      checkout(customerActor(user), key, input, { provider }),
    ]);
    for (const replay of replays) {
      expect(replay.created).toBe(false);
      expect(replay.order.id).toBe(first.order.id);
      expect(replay.order.paymentStatus).toBe("PENDING");
    }
    expect(provider.calls).toBe(1);
    expect(await db.payment.count({ where: { orderId: first.order.id } })).toBe(1);
    expect(await stockOf(product.id)).toBe(3);
  });

  it.each(Array.from({ length: REPEATS }, (_, i) => i + 1))(
    "run %i: two sweeps in parallel fail the order once, restore stock once, return the items once",
    async () => {
      const user = await signedIn();
      const product = await createProduct({ stock: 5 });
      const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 2 }]);
      const pending = await checkout(
        customerActor(user),
        newKey(),
        { addressId, paymentMethod: "MOCK", mockOutcome: "SUCCESS" },
        { provider: silentProvider() },
      );
      expect(await stockOf(product.id)).toBe(3);
      await overdue(pending.order.id);
      const [one, two] = await Promise.all([failOverdueOrders(15), failOverdueOrders(15)]);
      expect(one.errored + two.errored).toBe(0);
      expect(one.failed + two.failed).toBe(1);
      expect(await stockOf(product.id)).toBe(5);
      const order = await db.order.findUniqueOrThrow({ where: { id: pending.order.id } });
      expect(order.paymentStatus).toBe("FAILED");
      const lines = await db.cartItem.findMany({ where: { cart: { userId: user.userId } } });
      expect(lines.map((l) => l.quantity)).toEqual([2]);
      const item = await db.orderItem.findFirstOrThrow({
        where: { sellerOrder: { orderId: pending.order.id } },
      });
      expect(item.stockRestoredAt).not.toBeNull();
      expect([item.cartQuantityBeforeReturn, item.cartQuantityAfterReturn]).toEqual([0, 2]);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// CC-10
// ---------------------------------------------------------------------------------------------

describe("CC-10: inventory adjustments and a checkout on one product", () => {
  it.each(Array.from({ length: REPEATS }, (_, i) => i + 1))(
    "run %i: final stock is the start plus the accepted changes minus what was bought, never negative",
    async () => {
      const me = await signedInAs("SELLER");
      if (me.storeId === null) throw new Error("store expected");
      const actor = sellerActor({ userId: me.userId, storeId: me.storeId });
      const product = await createProduct({ storeId: me.storeId, stock: 5 });
      const buyer = await signedIn();
      const { addressId } = await readyToBuy(buyer, [{ productId: product.id, quantity: 2 }]);
      const deltas = [-2, 3, -4, -1, 2];
      const [sale, ...adjusts] = await Promise.allSettled([
        postCheckout(buyer, { addressId, paymentMethod: "MOCK" }),
        ...deltas.map((adjust) => changeStock(actor, product.id, { adjust })),
      ]);
      let expected = 5;
      adjusts.forEach((result, i) => {
        if (result.status === "fulfilled") expected += deltas[i] ?? 0;
        else {
          expect(result.reason).toMatchObject({ details: { reason: "NEGATIVE_STOCK" } });
        }
      });
      if (sale?.status !== "fulfilled") throw new Error("checkout threw");
      expect([201, 409]).toContain(sale.value.status);
      if (sale.value.status === 201) expected -= 2;
      else expect(sale.value.body.error.code).toBe("INSUFFICIENT_STOCK");
      const final = await stockOf(product.id);
      expect(final).toBeGreaterThanOrEqual(0);
      expect(final).toBe(expected);
    },
  );

  it("increases near the limit: exactly the ones that fit are accepted, the rest are STOCK_LIMIT, never above 1,000,000", async () => {
    const me = await signedInAs("SELLER");
    if (me.storeId === null) throw new Error("store expected");
    const actor = sellerActor({ userId: me.userId, storeId: me.storeId });
    const product = await createProduct({ storeId: me.storeId, stock: 999_998 });
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => changeStock(actor, product.id, { adjust: 1 })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    for (const r of results.filter((x) => x.status === "rejected")) {
      expect(r.reason).toMatchObject({ details: { reason: "STOCK_LIMIT" } });
    }
    expect(await stockOf(product.id)).toBe(1_000_000);
  });

  it.each(Array.from({ length: REPEATS }, (_, i) => i + 1))(
    "run %i: near the limit with a checkout in parallel, an increase is accepted only when it fits at that moment",
    async () => {
      const me = await signedInAs("SELLER");
      if (me.storeId === null) throw new Error("store expected");
      const actor = sellerActor({ userId: me.userId, storeId: me.storeId });
      const product = await createProduct({ storeId: me.storeId, stock: 999_999 });
      const buyer = await signedIn();
      const { addressId } = await readyToBuy(buyer, [{ productId: product.id, quantity: 1 }]);
      const [sale, plus1, plus1b] = await Promise.allSettled([
        postCheckout(buyer, { addressId, paymentMethod: "MOCK" }),
        changeStock(actor, product.id, { adjust: 1 }),
        changeStock(actor, product.id, { adjust: 1 }),
      ]);
      if (sale.status !== "fulfilled") throw new Error("checkout threw");
      expect(sale.value.status).toBe(201);
      const accepted = [plus1, plus1b].filter((r) => r.status === "fulfilled").length;
      for (const r of [plus1, plus1b].filter((x) => x.status === "rejected")) {
        expect(r.reason).toMatchObject({ details: { reason: "STOCK_LIMIT" } });
      }
      // Start 999,999, minus the one bought, plus what was accepted; the limit holds at each step.
      const final = await stockOf(product.id);
      expect(final).toBe(999_999 - 1 + accepted);
      expect(final).toBeLessThanOrEqual(1_000_000);
      // At least one increase always fits (999,999 + 1 = 1,000,000 serially in any order).
      expect(accepted).toBeGreaterThanOrEqual(1);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// CC-11
// ---------------------------------------------------------------------------------------------

describe("CC-11: price changes while a checkout is in flight", () => {
  it.each(Array.from({ length: REPEATS }, (_, i) => i + 1))(
    "run %i: the order uses the old or the new price, with consistent totals",
    async () => {
      const me = await signedInAs("SELLER");
      if (me.storeId === null) throw new Error("store expected");
      const product = await createProduct({ storeId: me.storeId, priceSatang: 10_000, stock: 50 });
      const buyer = await signedIn();
      const { addressId } = await readyToBuy(buyer, [{ productId: product.id, quantity: 3 }]);
      const [sale, patch] = await Promise.all([
        postCheckout(buyer, { addressId, paymentMethod: "MOCK" }),
        productCall.patch(product.id, { cookie: me.cookie, body: { priceSatang: 20_000 } }),
      ]);
      expect(patch.status).toBe(200);
      expect(sale.status).toBe(201);
      const item = await db.orderItem.findFirstOrThrow({
        where: { sellerOrder: { orderId: sale.body.data.id } },
        include: { sellerOrder: { include: { order: { include: { payment: true } } } } },
      });
      expect([10_000, 20_000]).toContain(item.unitPriceSatang);
      expect(item.quantity).toBe(3);
      expect(item.lineTotalSatang).toBe(3 * item.unitPriceSatang);
      expect(item.sellerOrder.itemsSubtotalSatang).toBe(item.lineTotalSatang);
      const order = item.sellerOrder.order;
      expect(order.itemsSubtotalSatang).toBe(item.lineTotalSatang);
      expect(order.grandTotalSatang).toBe(order.itemsSubtotalSatang + order.shippingTotalSatang);
      expect(order.payment?.amountSatang).toBe(order.grandTotalSatang);
      expect(sale.body.data.grandTotalSatang).toBe(order.grandTotalSatang);
      expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).priceSatang).toBe(
        20_000,
      );
    },
  );
});

// ---------------------------------------------------------------------------------------------
// CC-14
// ---------------------------------------------------------------------------------------------

describe("CC-14: stock bought by someone else between a refusal and the confirming submission", () => {
  async function lineOf(userId: string) {
    return db.cartItem.findMany({ where: { cart: { userId } }, select: { quantity: true } });
  }

  it("another customer buys in between: the confirmation is refused again and lowered again", async () => {
    const product = await createProduct({ stock: 3 });
    const a = await signedIn();
    const b = await signedIn();
    const ra = await readyToBuy(a, [{ productId: product.id, quantity: 5 }]);
    const rb = await readyToBuy(b, [{ productId: product.id, quantity: 2 }]);

    const refused = await postCheckout(a, { addressId: ra.addressId, paymentMethod: "MOCK" });
    expect(refused.status).toBe(409);
    expect(await lineOf(a.userId)).toEqual([{ quantity: 3 }]);

    expect((await postCheckout(b, { addressId: rb.addressId, paymentMethod: "MOCK" })).status).toBe(
      201,
    );
    expect(await stockOf(product.id)).toBe(1);

    const again = await postCheckout(a, { addressId: ra.addressId, paymentMethod: "MOCK" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("INSUFFICIENT_STOCK");
    expect(await lineOf(a.userId)).toEqual([{ quantity: 1 }]);
    expect(await stockOf(product.id)).toBe(1);
    expect((await rowsOf([a.userId])).orders).toBe(0);

    const confirmed = await postCheckout(a, { addressId: ra.addressId, paymentMethod: "MOCK" });
    expect(confirmed.status).toBe(201);
    expect(await stockOf(product.id)).toBe(0);
  });

  it.each(Array.from({ length: REPEATS }, (_, i) => i + 1))(
    "run %i: the other customer buys in parallel with the confirmation: no order holds more than was left",
    async () => {
      const product = await createProduct({ stock: 3 });
      const a = await signedIn();
      const b = await signedIn();
      const ra = await readyToBuy(a, [{ productId: product.id, quantity: 5 }]);
      const rb = await readyToBuy(b, [{ productId: product.id, quantity: 2 }]);
      expect(
        (await postCheckout(a, { addressId: ra.addressId, paymentMethod: "MOCK" })).status,
      ).toBe(409);
      expect(await lineOf(a.userId)).toEqual([{ quantity: 3 }]);

      const [confirm, other] = await Promise.all([
        postCheckout(a, { addressId: ra.addressId, paymentMethod: "MOCK" }),
        postCheckout(b, { addressId: rb.addressId, paymentMethod: "MOCK" }),
      ]);
      // 3 + 2 is more than the 3 units: exactly one of the two orders can exist.
      expect([confirm.status, other.status].filter((s) => s === 201)).toHaveLength(1);
      const bought = await db.orderItem.findMany({
        where: { productId: product.id },
        select: { quantity: true },
      });
      const total = bought.reduce((sum, i) => sum + i.quantity, 0);
      const final = await stockOf(product.id);
      expect(final).toBeGreaterThanOrEqual(0);
      expect(total + final).toBe(3);
      expect((await rowsOf([a.userId])).orders).toBeLessThanOrEqual(1);
      if (confirm.status === 201) {
        // The confirmation took all 3; the other customer is refused.
        expect([total, final]).toEqual([3, 0]);
        expect(other.status).toBe(409);
      } else {
        // The other customer took 2; the confirmation is refused again, lowered to the 1 left.
        expect([total, final]).toEqual([2, 1]);
        expect(confirm.status).toBe(409);
        expect(confirm.body.error.code).toBe("INSUFFICIENT_STOCK");
        expect(await lineOf(a.userId)).toEqual([{ quantity: 1 }]);
      }
    },
  );
});
