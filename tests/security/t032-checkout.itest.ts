/**
 * Security review of T-032 (checkout, orders, mock payment), 2026-10-14, against the worker's real
 * test database. Owner: security. Review: docs/reviews/T-032-security.md. Run with
 * `pnpm exec vitest run --config vitest.integration.config.mts tests/security/t032-checkout.itest.ts`.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 * The route handlers are called in process with a real `Request` and a real session cookie, as in
 * tests/integration/checkout. Each case makes its own users and products. Cases that document an
 * open finding say so; `it.fails` cases assert the secure behaviour and pass while it is missing.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { checkout } from "@/modules/checkout";
import type { PaymentProvider } from "@/modules/payments";
import type { Logger } from "@/server/logger";
import { db } from "@/server/db";

import {
  createCartItem,
  createCategory,
  createProduct,
  createStore,
  createUser,
} from "../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../helpers/snapshot";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../integration/auth/support";
import {
  getOrder,
  listOrders,
  newKey,
  postCheckout,
  readyToBuy,
  signedIn,
} from "../integration/checkout/support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

async function stockOf(productId: string): Promise<number> {
  const row = await db.product.findUniqueOrThrow({
    where: { id: productId },
    select: { stock: true },
  });
  return row.stock;
}

function snapshot() {
  return snapshotDatabase({ excludeTables: ["Session"] });
}

describe("T-032 review: double submission and races (TM-10, TM-11)", () => {
  it("five simultaneous requests with one key: one order, one decrement, every answer the same order", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 10 });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 3 }]);
    const key = newKey();
    const answers = await Promise.all(
      Array.from({ length: 5 }, () =>
        postCheckout(user, { addressId, paymentMethod: "MOCK" }, { key }),
      ),
    );
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(answers.map((answer) => answer.body.data.id)).size).toBe(1);
    expect(await db.order.count({ where: { userId: user.userId } })).toBe(1);
    expect(await db.payment.count({ where: { order: { userId: user.userId } } })).toBe(1);
    expect(await stockOf(product.id)).toBe(7);
  });

  it("three simultaneous requests with three keys on one cart: one order, the others CART_EMPTY", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 10 });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 2 }]);
    const answers = await Promise.all(
      Array.from({ length: 3 }, () => postCheckout(user, { addressId, paymentMethod: "MOCK" })),
    );
    expect(answers.map((answer) => answer.status).sort()).toEqual([201, 409, 409]);
    for (const answer of answers.filter((entry) => entry.status === 409)) {
      expect(answer.body.error.code).toBe("CART_EMPTY");
    }
    expect(await db.order.count({ where: { userId: user.userId } })).toBe(1);
    expect(await stockOf(product.id)).toBe(8);
  });

  it("four buyers race for three units: at most three sold, stock never negative", async () => {
    const product = await createProduct({ stock: 3 });
    const buyers = await Promise.all(Array.from({ length: 4 }, () => signedIn()));
    const ready = await Promise.all(
      buyers.map((buyer) => readyToBuy(buyer, [{ productId: product.id, quantity: 1 }])),
    );
    const answers = await Promise.all(
      buyers.map((buyer, i) =>
        postCheckout(buyer, { addressId: ready[i]?.addressId, paymentMethod: "MOCK" }),
      ),
    );
    expect(answers.map((answer) => answer.status).sort()).toEqual([201, 201, 201, 409]);
    expect(await stockOf(product.id)).toBe(0);
  });
});

describe("T-032 review: the client cannot choose what is bought or what it costs (TM-08, TM-27)", () => {
  it("a body naming a price, total, quantity, owner, store, or status is 400 and stores nothing", async () => {
    const user = await signedIn();
    const other = await createUser();
    const store = await createStore();
    const product = await createProduct({ storeId: store.id, priceSatang: 50_000, stock: 5 });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 1 }]);
    const before = await snapshot();
    for (const extra of [
      { grandTotalSatang: 1 },
      { itemsSubtotalSatang: 1, shippingTotalSatang: 0 },
      { items: [{ productId: product.id, quantity: 99, priceSatang: 1 }] },
      { userId: other.id },
      { storeId: store.id },
      { paymentStatus: "PAID" },
      { mockOutcome: "PAID" },
      { paymentMethod: "CARD" },
    ]) {
      const answer = await postCheckout(user, { addressId, paymentMethod: "MOCK", ...extra });
      expect(answer.status, JSON.stringify(extra)).toBe(400);
      expect(answer.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect(diffSnapshots(before, await snapshot())).toEqual([]);
  });

  it("the price charged is the database's at the moment of purchase, not the cart's or an old one", async () => {
    const user = await signedIn();
    const product = await createProduct({ priceSatang: 10_000, stock: 5 });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 2 }]);
    await db.product.update({ where: { id: product.id }, data: { priceSatang: 12_345 } });
    const answer = await postCheckout(user, { addressId, paymentMethod: "MOCK" });
    expect(answer.status).toBe(201);
    expect(answer.body.data.itemsSubtotalSatang).toBe(24_690);
    const payment = await db.payment.findFirstOrThrow({
      where: { orderId: answer.body.data.id },
      select: { amountSatang: true, provider: true },
    });
    expect(payment).toEqual({ provider: "MOCK", amountSatang: answer.body.data.grandTotalSatang });
  });
});

describe("T-032 review: a product that is not visible cannot be bought (BR-22, TM-26)", () => {
  for (const [label, hide] of [
    ["the store is suspended", { store: { status: "SUSPENDED" } }],
    ["the store owner is deactivated", { owner: { isActive: false } }],
    ["the category is inactive", { category: { isActive: false } }],
    ["the product is a draft", { product: { status: "DRAFT" } }],
    ["the product awaits moderation", { product: { moderationStatus: "PENDING" } }],
  ] as const) {
    it(`${label}: NOT_AVAILABLE, no stock taken, no order`, async () => {
      const user = await signedIn();
      const owner = await createUser({ role: "SELLER" });
      const store = await createStore({ ownerId: owner.id });
      const category = await createCategory();
      const product = await createProduct({ storeId: store.id, categoryId: category.id, stock: 5 });
      const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 1 }]);
      if ("store" in hide) await db.store.update({ where: { id: store.id }, data: hide.store });
      if ("owner" in hide) await db.user.update({ where: { id: owner.id }, data: hide.owner });
      if ("category" in hide) {
        await db.category.update({ where: { id: category.id }, data: hide.category });
      }
      if ("product" in hide) {
        await db.product.update({ where: { id: product.id }, data: hide.product });
      }
      const answer = await postCheckout(user, { addressId, paymentMethod: "MOCK" });
      expect(answer.status).toBe(409);
      expect(answer.body.error.details.items).toEqual([
        expect.objectContaining({ productId: product.id, reason: "NOT_AVAILABLE" }),
      ]);
      expect(await stockOf(product.id)).toBe(5);
      expect(await db.order.count({ where: { userId: user.userId } })).toBe(0);
    });
  }

  it("a deactivated buyer's session is refused before anything is read", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 5 });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 1 }]);
    await db.user.update({ where: { id: user.userId }, data: { isActive: false } });
    const answer = await postCheckout(user, { addressId, paymentMethod: "MOCK" });
    expect(answer.status).toBe(401);
    expect(await stockOf(product.id)).toBe(5);
  });
});

describe("T-032 review: orders are the caller's only (TM-05, BR-37)", () => {
  it("a foreign order id, its order number, and an unknown id give the same 404; the list ignores a userId", async () => {
    const me = await signedIn();
    const other = await signedIn();
    const product = await createProduct({ stock: 5 });
    const theirs = await readyToBuy(other, [{ productId: product.id, quantity: 1 }]);
    const placed = await postCheckout(other, {
      addressId: theirs.addressId,
      paymentMethod: "MOCK",
    });
    expect(placed.status).toBe(201);
    const foreign = placed.body.data;

    const strip = (error: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(error).filter(([key]) => key !== "requestId"));
    const byId = await getOrder(me, foreign.id);
    const byNumber = await getOrder(me, foreign.orderNumber);
    const unknown = await getOrder(me, "c".repeat(24));
    for (const answer of [byId, byNumber, unknown]) expect(answer.status).toBe(404);
    expect(strip(byId.body.error)).toEqual(strip(unknown.body.error));
    expect(strip(byNumber.body.error)).toEqual(strip(unknown.body.error));
    expect(JSON.stringify(byId.body)).not.toContain(foreign.shippingAddress.phone);

    const list = await listOrders(me, `?userId=${other.userId}`);
    // An unknown query key is either refused or ignored; never another user's orders.
    if (list.status === 200) expect(list.body.data).toEqual([]);
    else expect(list.status).toBe(400);
  });

  it("an idempotency key another user used returns nothing of theirs", async () => {
    const key = newKey();
    const owner = await signedIn();
    const prober = await signedIn();
    const product = await createProduct({ stock: 5 });
    const ownerCart = await readyToBuy(owner, [{ productId: product.id, quantity: 1 }]);
    expect(
      (
        await postCheckout(
          owner,
          { addressId: ownerCart.addressId, paymentMethod: "MOCK" },
          { key },
        )
      ).status,
    ).toBe(201);
    const proberCart = await readyToBuy(prober, []);
    const probe = await postCheckout(
      prober,
      { addressId: proberCart.addressId, paymentMethod: "MOCK" },
      { key },
    );
    expect(probe.status).toBe(409);
    expect(probe.body.error.code).toBe("CART_EMPTY");
  });
});

describe("T-032 review: the mock payment cannot be replayed or turned (TM-12)", () => {
  it("a repeat of a paid order's key asking for FAIL changes nothing and calls no provider", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 5 });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 2 }]);
    const key = newKey();
    const paid = await postCheckout(user, { addressId, paymentMethod: "MOCK" }, { key });
    expect(paid.body.data.paymentStatus).toBe("PAID");
    const before = await snapshot();
    const repeat = await postCheckout(
      user,
      { addressId, paymentMethod: "MOCK", mockOutcome: "FAIL" },
      { key },
    );
    expect(repeat.status).toBe(200);
    expect(repeat.body.data.paymentStatus).toBe("PAID");
    expect(diffSnapshots(before, await snapshot())).toEqual([]);
    expect(await stockOf(product.id)).toBe(3);
  });

  it("repeated simulated declines never raise the stock above where it started", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 4 });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 3 }]);
    for (let round = 0; round < 3; round += 1) {
      const answer = await postCheckout(user, {
        addressId,
        paymentMethod: "MOCK",
        mockOutcome: "FAIL",
      });
      expect(answer.status).toBe(201);
      expect(answer.body.data.paymentStatus).toBe("FAILED");
      expect(await stockOf(product.id)).toBe(4);
    }
    const restored = await db.orderItem.count({
      where: { sellerOrder: { order: { userId: user.userId } }, stockRestoredAt: { not: null } },
    });
    expect(restored).toBe(3);
  });

  it("a provider that does not answer: one warn line with the provider and error class only", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 5 });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 1 }]);
    const lines: { level: string; message: string; fields: unknown }[] = [];
    const log: Logger = {
      debug: (message, fields) => lines.push({ level: "debug", message, fields }),
      info: (message, fields) => lines.push({ level: "info", message, fields }),
      warn: (message, fields) => lines.push({ level: "warn", message, fields }),
      error: (message, fields) => lines.push({ level: "error", message, fields }),
      child: () => log,
    };
    const secret = "provider-said-0812345678-someone@example.com";
    const silent: PaymentProvider = {
      name: "MOCK",
      isSimulated: true,
      charge: () => Promise.reject(new Error(secret)),
    };
    const result = await checkout(
      { userId: user.userId, role: "CUSTOMER", storeId: null, storeStatus: null },
      newKey(),
      { addressId, paymentMethod: "MOCK", mockOutcome: "SUCCESS" },
      { log, provider: silent },
    );
    expect(result.order.paymentStatus).toBe("PENDING");
    expect(lines).toEqual([
      {
        level: "warn",
        message: "Payment provider did not answer; the order stays PENDING",
        fields: { component: "checkout", provider: "MOCK", errorClass: "Error" },
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain(secret);
  });
});

describe("T-032 review: the checkout rate limit (section 6)", () => {
  it("the eleventh request in a minute is 429 even when the first ten were refused as invalid", async () => {
    const user = await signedIn();
    const { addressId } = await readyToBuy(user, []);
    for (let i = 0; i < 10; i += 1) {
      const answer = await postCheckout(user, { addressId, paymentMethod: "MOCK" }, { key: null });
      expect(answer.status).toBe(400);
    }
    const limited = await postCheckout(user, { addressId, paymentMethod: "MOCK" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
  });
});

describe("SEC-053 in checkout: no bound on the number of lines one checkout takes stock for", () => {
  // 120 lines: above the 100 that SEC-053 proposes. A fixed maximum must refuse the checkout
  // before any product row is locked; today the whole cart is bought in one transaction.
  it.fails(
    "a cart above the proposed line maximum is refused and takes no stock",
    async () => {
      const user = await signedIn();
      const store = await createStore();
      const category = await createCategory();
      const { addressId, cartId } = await readyToBuy(user, []);
      const cart = { id: cartId };
      const ids: string[] = [];
      for (let i = 0; i < 120; i += 1) {
        const product = await createProduct({
          storeId: store.id,
          categoryId: category.id,
          stock: 5,
        });
        await createCartItem({ cartId: cart.id, productId: product.id, quantity: 1 });
        ids.push(product.id);
      }
      const answer = await postCheckout(user, { addressId, paymentMethod: "MOCK" });
      expect(answer.status).toBeGreaterThanOrEqual(400);
      expect(await db.product.count({ where: { id: { in: ids }, stock: { lt: 5 } } })).toBe(0);
    },
    60_000,
  );
});

describe("SEC-056 (documented behaviour): with the mock any account takes any stock as PAID", () => {
  it("one account buys a seller's whole stock for nothing and the order is PAID", async () => {
    const user = await signedIn();
    const product = await createProduct({ priceSatang: 1_999_900, stock: 99 });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 99 }]);
    const answer = await postCheckout(user, { addressId, paymentMethod: "MOCK" });
    expect(answer.status).toBe(201);
    expect(answer.body.data.paymentStatus).toBe("PAID");
    expect(answer.body.data.payment.isSimulated).toBe(true);
    expect(await stockOf(product.id)).toBe(0);
  });
});
