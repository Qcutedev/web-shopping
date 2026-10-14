/**
 * T-032: `POST /api/v1/checkout`, `GET /api/v1/orders`, `GET /api/v1/orders/{id}` against the
 * worker's real test database (docs/API_CONTRACTS.md section 5.5; REQ-C-11 to REQ-C-13; BR-04,
 * BR-07 to BR-09, BR-15, BR-16, BR-20, BR-22, BR-30, BR-32, BR-39). Each case makes its own users
 * and products, because the database is emptied once per file, not per case. The race cases of
 * T-033 belong to qa; two basic ones are in concurrency.test.ts.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { checkout, CHECKOUT_ATTEMPTS } from "@/modules/checkout";
import { takeStock } from "@/modules/checkout/repository";
import { completeOrderPayment, failOrderPayment, failOverdueOrders } from "@/modules/orders";
import type { PaymentProvider } from "@/modules/payments";
import { db } from "@/server/db";

import {
  createAddress,
  createCart,
  createCartItem,
  createProduct,
  createProductImage,
  createStore,
  createUpload,
} from "../../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../../helpers/snapshot";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import { getOrder, listOrders, newKey, postCheckout, readyToBuy, signedIn } from "./support";

/**
 * Fault-injection seam, used only by the cases that say so: `takeStock` runs the real statement
 * unless a case queues a one-time replacement. The database stays real.
 */
vi.mock("@/modules/checkout/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/checkout/repository")>();
  return { ...actual, takeStock: vi.fn(actual.takeStock) };
});

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

afterEach(() => {
  // Back to the real implementation, queued one-time replacements dropped.
  vi.mocked(takeStock).mockReset();
});

function actorOf(user: { userId: string }) {
  return { userId: user.userId, role: "CUSTOMER", storeId: null, storeStatus: null } as const;
}

/** A promise settled from outside, to hold a step of a concurrent flow. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** Whether `promise` settles within `ms`; it is not consumed. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  const pending = Symbol("pending");
  const result = await Promise.race([
    promise.then(
      () => "settled",
      () => "settled",
    ),
    new Promise((resolve) => setTimeout(() => resolve(pending), ms)),
  ]);
  return result !== pending;
}

async function stockOf(productId: string): Promise<number> {
  const row = await db.product.findUniqueOrThrow({
    where: { id: productId },
    select: { stock: true },
  });
  return row.stock;
}

async function cartLines(userId: string) {
  return db.cartItem.findMany({
    where: { cart: { userId } },
    select: { productId: true, quantity: true },
    orderBy: { productId: "asc" },
  });
}

describe("POST /api/v1/checkout: success", () => {
  it("places one order with one seller order per store, at database prices, and pays it (mock)", async () => {
    const user = await signedIn();
    const storeA = await createStore({ name: "ร้านเอ" });
    const storeB = await createStore({ name: "ร้านบี" });
    const a = await createProduct({ storeId: storeA.id, priceSatang: 25_900, stock: 5 });
    const b = await createProduct({ storeId: storeB.id, priceSatang: 10_000, stock: 2 });
    const { addressId } = await readyToBuy(user, [
      { productId: a.id, quantity: 3 },
      { productId: b.id, quantity: 1 },
    ]);

    const response = await postCheckout(user, { addressId, paymentMethod: "MOCK" });
    expect(response.status).toBe(201);
    const order = response.body.data;
    expect(order.paymentStatus).toBe("PAID");
    expect(order.paidAt).not.toBeNull();
    expect(order.payment).toEqual({ provider: "MOCK", isSimulated: true, failureReason: null });
    expect(order.orderNumber).toMatch(/^OD\d{13,}$/);
    expect(order.itemsSubtotalSatang).toBe(87_700);
    expect(order.shippingTotalSatang).toBe(8_000);
    expect(order.grandTotalSatang).toBe(95_700);
    expect(order.cartReturn).toBeNull();
    expect(order.sellerOrders.map((part) => part.storeName).sort()).toEqual(["ร้านบี", "ร้านเอ"]);
    for (const part of order.sellerOrders) {
      expect(part).toMatchObject({
        fulfilmentStatus: "PENDING",
        cancellationKind: null,
        shippingFeeSatang: 4_000,
        shippingFeeIsSimulated: true,
        shipment: null,
      });
    }

    expect(await stockOf(a.id)).toBe(2);
    expect(await stockOf(b.id)).toBe(1);
    expect(await cartLines(user.userId)).toEqual([]);

    const stored = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      select: {
        paidAt: true,
        payment: { select: { provider: true, providerReference: true, amountSatang: true } },
        sellerOrders: { select: { commissionRateBps: true } },
      },
    });
    expect(stored.payment?.provider).toBe("MOCK");
    expect(stored.payment?.providerReference).toMatch(/^MOCK-/);
    expect(stored.payment?.amountSatang).toBe(95_700);
    expect(stored.sellerOrders.map((part) => part.commissionRateBps)).toEqual([500, 500]);
  });

  it("copies title, SKU, price, picture, store name, and address; later edits change nothing (BR-09)", async () => {
    const user = await signedIn();
    const store = await createStore({ name: "ชื่อเดิม" });
    const product = await createProduct({
      storeId: store.id,
      title: "ชื่อสินค้าเดิม",
      sku: "OLD-1",
      priceSatang: 5_000,
    });
    const upload = await createUpload({ storeId: store.id });
    await createProductImage({ productId: product.id, uploadId: upload.id, sortOrder: 0 });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 2 }]);

    const placed = await postCheckout(user, { addressId, paymentMethod: "MOCK" });
    expect(placed.status).toBe(201);

    await db.product.update({
      where: { id: product.id },
      data: { title: "ใหม่", sku: "NEW-1", priceSatang: 9_900 },
    });
    await db.store.update({ where: { id: store.id }, data: { name: "ชื่อใหม่" } });
    await db.address.update({
      where: { id: addressId },
      data: { line1: "ที่อยู่ใหม่" },
    });

    const read = await getOrder(user, placed.body.data.id);
    expect(read.status).toBe(200);
    const part = read.body.data.sellerOrders[0];
    expect(part?.storeName).toBe("ชื่อเดิม");
    expect(part?.items[0]).toMatchObject({
      productTitle: "ชื่อสินค้าเดิม",
      productSku: "OLD-1",
      unitPriceSatang: 5_000,
      quantity: 2,
      lineTotalSatang: 10_000,
      image: { key: upload.storageKey },
    });
    expect(read.body.data.shippingAddress.line1).not.toBe("ที่อยู่ใหม่");
  });
});

describe("POST /api/v1/checkout: idempotency (section 1.3)", () => {
  it("a repeat with the same key returns the same order with 200 and creates nothing", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 5 });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 1 }]);
    const key = newKey();
    const first = await postCheckout(user, { addressId, paymentMethod: "MOCK" }, { key });
    expect(first.status).toBe(201);
    // A new line in the cart must not be bought by the repeat.
    await createCartItem({
      cartId: (await db.cart.findUniqueOrThrow({ where: { userId: user.userId } })).id,
      productId: product.id,
      quantity: 1,
    });
    const before = await snapshotDatabase({ excludeTables: ["Session"] });
    const repeat = await postCheckout(
      user,
      { addressId, paymentMethod: "MOCK" },
      { key: key.toUpperCase() },
    );
    expect(repeat.status).toBe(200);
    expect(repeat.body.data.id).toBe(first.body.data.id);
    expect(diffSnapshots(before, await snapshotDatabase({ excludeTables: ["Session"] }))).toEqual(
      [],
    );
  });

  it("the same key from another user is a different checkout", async () => {
    const key = newKey();
    const one = await signedIn();
    const two = await signedIn();
    const product = await createProduct({ stock: 5 });
    const a = await readyToBuy(one, [{ productId: product.id, quantity: 1 }]);
    const b = await readyToBuy(two, [{ productId: product.id, quantity: 1 }]);
    const first = await postCheckout(
      one,
      { addressId: a.addressId, paymentMethod: "MOCK" },
      { key },
    );
    const second = await postCheckout(
      two,
      { addressId: b.addressId, paymentMethod: "MOCK" },
      { key },
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).not.toBe(first.body.data.id);
  });
});

describe("POST /api/v1/checkout: refusals that change nothing", () => {
  it("guest 401, missing key 400, an amount in the body 400: nothing stored", async () => {
    const user = await signedIn();
    const product = await createProduct();
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 1 }]);
    const before = await snapshotDatabase({ excludeTables: ["Session"] });

    expect((await postCheckout(null, { addressId, paymentMethod: "MOCK" })).status).toBe(401);
    const noKey = await postCheckout(user, { addressId, paymentMethod: "MOCK" }, { key: null });
    expect(noKey.status).toBe(400);
    expect(noKey.body.error.details).toEqual({
      fields: [expect.objectContaining({ path: "Idempotency-Key", code: "invalid_header" })],
    });
    const tampered = await postCheckout(user, {
      addressId,
      paymentMethod: "MOCK",
      grandTotalSatang: 1,
    });
    expect(tampered.status).toBe(400);

    expect(diffSnapshots(before, await snapshotDatabase({ excludeTables: ["Session"] }))).toEqual(
      [],
    );
  });

  it("another user's address is 404 with resource address; no order, stock unchanged", async () => {
    const user = await signedIn();
    const other = await signedIn();
    const product = await createProduct({ stock: 4 });
    await readyToBuy(user, [{ productId: product.id, quantity: 1 }]);
    const foreign = await readyToBuy(other, []);
    const response = await postCheckout(user, {
      addressId: foreign.addressId,
      paymentMethod: "MOCK",
    });
    expect(response.status).toBe(404);
    expect(response.body.error.details).toEqual({ resource: "address" });
    expect(await stockOf(product.id)).toBe(4);
    expect(await db.order.count({ where: { userId: user.userId } })).toBe(0);
  });

  it("an empty cart is 409 CART_EMPTY with no details; nothing stored", async () => {
    const user = await signedIn();
    const { addressId } = await readyToBuy(user, []);
    const before = await snapshotDatabase({ excludeTables: ["Session"] });
    const response = await postCheckout(user, { addressId, paymentMethod: "MOCK" });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("CART_EMPTY");
    expect(response.body.error.details).toEqual({});
    expect(diffSnapshots(before, await snapshotDatabase({ excludeTables: ["Session"] }))).toEqual(
      [],
    );
  });

  it("a user who never had a cart row is 409 CART_EMPTY; no cart row and no order is created", async () => {
    const user = await signedIn();
    const address = await createAddress({ userId: user.userId });
    expect(await db.cart.count({ where: { userId: user.userId } })).toBe(0);
    const before = await snapshotDatabase({ excludeTables: ["Session"] });
    const response = await postCheckout(user, {
      addressId: address.id,
      paymentMethod: "MOCK",
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("CART_EMPTY");
    expect(response.body.error.details).toEqual({});
    expect(await db.cart.count({ where: { userId: user.userId } })).toBe(0);
    expect(await db.order.count({ where: { userId: user.userId } })).toBe(0);
    expect(diffSnapshots(before, await snapshotDatabase({ excludeTables: ["Session"] }))).toEqual(
      [],
    );
  });

  it("no cart with another user's address is 404 address, not CART_EMPTY (the address is checked first)", async () => {
    const user = await signedIn();
    const other = await signedIn();
    const foreign = await createAddress({ userId: other.userId });
    const response = await postCheckout(user, { addressId: foreign.id, paymentMethod: "MOCK" });
    expect(response.status).toBe(404);
    expect(response.body.error.details).toEqual({ resource: "address" });
  });

  it("a grand total above BR-04 is 422; stock and cart unchanged", async () => {
    const user = await signedIn();
    const product = await createProduct({ priceSatang: 100_000_000, stock: 50 });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 21 }]);
    const response = await postCheckout(user, { addressId, paymentMethod: "MOCK" });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("ORDER_LIMIT_EXCEEDED");
    expect(await stockOf(product.id)).toBe(50);
    expect(await cartLines(user.userId)).toEqual([{ productId: product.id, quantity: 21 }]);
  });
});

describe("POST /api/v1/checkout: a line that cannot be bought (BR-22, D-029 point 2)", () => {
  it("a quantity above the stock stops the checkout, stores the lowered quantity, and the resubmit buys it", async () => {
    const user = await signedIn();
    const ok = await createProduct({ priceSatang: 1_000, stock: 10 });
    const low = await createProduct({ priceSatang: 500, stock: 3 });
    const { addressId } = await readyToBuy(user, [
      { productId: ok.id, quantity: 2 },
      { productId: low.id, quantity: 5 },
    ]);

    const refused = await postCheckout(user, { addressId, paymentMethod: "MOCK" });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("INSUFFICIENT_STOCK");
    expect(refused.body.error.details.items).toEqual([
      expect.objectContaining({
        productId: low.id,
        reason: "INSUFFICIENT_STOCK",
        requestedQuantity: 5,
        availableStock: 3,
      }),
    ]);
    expect(refused.body.error.details["totals"]).toEqual({
      itemsSubtotalSatang: 2_000 + 1_500,
      shippingTotalSatang: 8_000,
      grandTotalSatang: 11_500,
    });
    expect(await stockOf(ok.id)).toBe(10);
    expect(await stockOf(low.id)).toBe(3);
    expect(await cartLines(user.userId)).toEqual(
      [
        { productId: ok.id, quantity: 2 },
        { productId: low.id, quantity: 3 },
      ].sort((x, y) => (x.productId < y.productId ? -1 : 1)),
    );
    expect(await db.order.count({ where: { userId: user.userId } })).toBe(0);

    const confirmed = await postCheckout(user, { addressId, paymentMethod: "MOCK" });
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.data.grandTotalSatang).toBe(11_500);
    expect(await stockOf(low.id)).toBe(0);
  });

  it("stock taken for an earlier line is given back when a later line fails (the savepoint)", async () => {
    const user = await signedIn();
    const [first, second] = [
      await createProduct({ stock: 10 }),
      await createProduct({ stock: 10 }),
    ];
    // The stock statements run in product id order: make the lower id buyable, the higher not.
    const [earlier, later] = [first, second].sort((x, y) => (x.id < y.id ? -1 : 1));
    if (earlier === undefined || later === undefined) throw new Error("two products expected");
    await db.product.update({ where: { id: later.id }, data: { stock: 1 } });
    const { addressId } = await readyToBuy(user, [
      { productId: earlier.id, quantity: 4 },
      { productId: later.id, quantity: 2 },
    ]);

    const refused = await postCheckout(user, { addressId, paymentMethod: "MOCK" });
    expect(refused.status).toBe(409);
    expect(await stockOf(earlier.id)).toBe(10);
    expect(await stockOf(later.id)).toBe(1);
  });

  it("hidden, own-store, and sold-out lines are all named; none is lowered; code PRODUCT_UNAVAILABLE", async () => {
    const seller = await signedIn("SELLER");
    const ownStore = await createStore({ ownerId: seller.userId });
    const own = await createProduct({ storeId: ownStore.id });
    const hidden = await createProduct({ moderationStatus: "TAKEN_DOWN" });
    const soldOut = await createProduct({ stock: 0 });
    const fine = await createProduct({ stock: 9 });
    const { addressId } = await readyToBuy(seller, [
      { productId: own.id, quantity: 1 },
      { productId: hidden.id, quantity: 2 },
      { productId: soldOut.id, quantity: 3 },
      { productId: fine.id, quantity: 1 },
    ]);
    const before = await cartLines(seller.userId);

    const refused = await postCheckout(seller, { addressId, paymentMethod: "MOCK" });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("PRODUCT_UNAVAILABLE");
    const byProduct = new Map(
      (refused.body.error.details.items ?? []).map((item) => [item["productId"], item]),
    );
    expect(byProduct.get(own.id)).toMatchObject({ reason: "OWN_STORE", availableStock: null });
    expect(byProduct.get(hidden.id)).toMatchObject({
      reason: "NOT_AVAILABLE",
      availableStock: null,
    });
    expect(byProduct.get(soldOut.id)).toMatchObject({
      reason: "INSUFFICIENT_STOCK",
      availableStock: 0,
    });
    expect(byProduct.has(fine.id)).toBe(false);
    expect(await cartLines(seller.userId)).toEqual(before);
    expect(await stockOf(fine.id)).toBe(9);
  });
});

describe("own store (BR-16)", () => {
  it("a cart holding only a line of the caller's own store is refused by the stock statement itself", async () => {
    const seller = await signedIn("SELLER");
    const ownStore = await createStore({ ownerId: seller.userId });
    const own = await createProduct({ storeId: ownStore.id, stock: 5 });
    const { addressId } = await readyToBuy(seller, [{ productId: own.id, quantity: 2 }]);

    const refused = await postCheckout(seller, { addressId, paymentMethod: "MOCK" });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("PRODUCT_UNAVAILABLE");
    expect(refused.body.error.details.items).toEqual([
      expect.objectContaining({ productId: own.id, reason: "OWN_STORE", availableStock: null }),
    ]);
    expect(await stockOf(own.id)).toBe(5);
    expect(await db.order.count({ where: { userId: seller.userId } })).toBe(0);
  });
});

describe("mock payment failure and the timeout (BR-20, BR-32)", () => {
  it("a simulated decline: FAILED, parts cancelled, stock restored once, items back in the cart", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 4 });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 3 }]);
    const key = newKey();

    const response = await postCheckout(
      user,
      { addressId, paymentMethod: "MOCK", mockOutcome: "FAIL" },
      { key },
    );
    expect(response.status).toBe(201);
    const order = response.body.data;
    expect(order.paymentStatus).toBe("FAILED");
    expect(order.paidAt).toBeNull();
    expect(order.payment.failureReason).toBe("SIMULATED_DECLINE");
    expect(
      order.sellerOrders.map((part) => [part.fulfilmentStatus, part.cancellationKind]),
    ).toEqual([["CANCELLED", "PAYMENT_FAILED"]]);
    expect(order.cartReturn).toEqual({
      capped: false,
      items: [{ productId: product.id, orderedQuantity: 3, cartQuantity: 3, capped: false }],
    });
    expect(await stockOf(product.id)).toBe(4);
    expect(await cartLines(user.userId)).toEqual([{ productId: product.id, quantity: 3 }]);

    // The repeat returns the same failed order and changes nothing.
    const before = await snapshotDatabase({ excludeTables: ["Session"] });
    const repeat = await postCheckout(user, { addressId, paymentMethod: "MOCK" }, { key });
    expect(repeat.status).toBe(200);
    expect(repeat.body.data).toEqual(order);
    expect(diffSnapshots(before, await snapshotDatabase({ excludeTables: ["Session"] }))).toEqual(
      [],
    );

    // The failed order stays in the customer's history (OQ-25).
    const list = await listOrders(user);
    expect(list.body.data.map((entry) => entry.id)).toContain(order.id);
  });

  it("a provider that does not answer leaves PENDING; the sweep fails it after the timeout with capped merge", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 60 });
    const { addressId, cartId } = await readyToBuy(user, [{ productId: product.id, quantity: 50 }]);
    const silent: PaymentProvider = {
      name: "MOCK",
      isSimulated: true,
      charge: () => Promise.reject(new Error("no answer")),
    };
    const actor = {
      userId: user.userId,
      role: "CUSTOMER",
      storeId: null,
      storeStatus: null,
    } as const;
    const result = await checkout(
      actor,
      newKey(),
      { addressId, paymentMethod: "MOCK", mockOutcome: "SUCCESS" },
      { provider: silent },
    );
    expect(result.order.paymentStatus).toBe("PENDING");
    expect(await stockOf(product.id)).toBe(10);

    // A younger order is not failed.
    await failOverdueOrders(15);
    expect((await getOrder(user, result.order.id)).body.data.paymentStatus).toBe("PENDING");

    await createCartItem({ cartId, productId: product.id, quantity: 60 });
    await db.$executeRaw`UPDATE "Order" SET "createdAt" = now() - interval '16 minutes' WHERE "id" = ${result.order.id}`;
    // This file's only overdue PENDING order is the one above (the database is per file).
    const swept = await failOverdueOrders(15);
    expect(swept).toEqual({ found: 1, failed: 1, errored: 0 });

    const failed = (await getOrder(user, result.order.id)).body.data;
    expect(failed.paymentStatus).toBe("FAILED");
    expect(failed.payment.failureReason).toBe("TIMEOUT");
    expect(failed.cartReturn).toEqual({
      capped: true,
      items: [{ productId: product.id, orderedQuantity: 50, cartQuantity: 60, capped: true }],
    });
    expect(await stockOf(product.id)).toBe(60);
    expect(await cartLines(user.userId)).toEqual([{ productId: product.id, quantity: 60 }]);
    // A second sweep does not restore twice.
    await failOverdueOrders(15);
    expect(await stockOf(product.id)).toBe(60);
  });
});

describe("GET /api/v1/orders and /orders/{id} (REQ-C-13)", () => {
  it("lists only the caller's orders, newest first; another user's order is 404", async () => {
    const me = await signedIn();
    const other = await signedIn();
    const product = await createProduct({ stock: 10 });
    const mine = await readyToBuy(me, [{ productId: product.id, quantity: 1 }]);
    const first = await postCheckout(me, { addressId: mine.addressId, paymentMethod: "MOCK" });
    await createCartItem({ cartId: mine.cartId, productId: product.id, quantity: 1 });
    const second = await postCheckout(me, { addressId: mine.addressId, paymentMethod: "MOCK" });
    const theirs = await readyToBuy(other, [{ productId: product.id, quantity: 1 }]);
    const foreign = await postCheckout(other, {
      addressId: theirs.addressId,
      paymentMethod: "MOCK",
    });

    const list = await listOrders(me, "?pageSize=1");
    expect(list.status).toBe(200);
    expect(list.body.meta).toEqual({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
    expect(list.body.data.map((order) => order.id)).toEqual([second.body.data.id]);
    const page2 = await listOrders(me, "?page=2&pageSize=1");
    expect(page2.body.data.map((order) => order.id)).toEqual([first.body.data.id]);

    const denied = await getOrder(me, foreign.body.data.id);
    expect(denied.status).toBe(404);
    expect(denied.body.error.details).toEqual({});
    expect((await getOrder(null, first.body.data.id)).status).toBe(401);
    expect((await listOrders(null)).status).toBe(401);
  });

  it("an empty cart row for the user does not count as an order", async () => {
    const user = await signedIn();
    await createCart({ userId: user.userId });
    const list = await listOrders(user);
    expect(list.body.data).toEqual([]);
    expect(list.body.meta["total"]).toBe(0);
  });
});

describe("checkout attempts (step 7: the stock changed between the take and the read)", () => {
  const noStock = () => Promise.resolve(null);

  it("a take refused while every line is buyable on the read is tried again, and the third try buys", async () => {
    const user = await signedIn();
    const product = await createProduct({ priceSatang: 2_000, stock: 5 });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 2 }]);
    for (let i = 1; i < CHECKOUT_ATTEMPTS; i += 1) {
      vi.mocked(takeStock).mockImplementationOnce(noStock);
    }

    const response = await postCheckout(user, { addressId, paymentMethod: "MOCK" });
    expect(response.status).toBe(201);
    expect(response.body.data.paymentStatus).toBe("PAID");
    expect(response.body.data.itemsSubtotalSatang).toBe(4_000);
    expect(vi.mocked(takeStock)).toHaveBeenCalledTimes(CHECKOUT_ATTEMPTS);
    // One order, the stock taken once, the cart emptied.
    expect(await db.order.count({ where: { userId: user.userId } })).toBe(1);
    expect(await stockOf(product.id)).toBe(3);
    expect(await cartLines(user.userId)).toEqual([]);
  });

  it("after CHECKOUT_ATTEMPTS refused takes the request is a server error and stores nothing", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 5 });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 2 }]);
    for (let i = 0; i < CHECKOUT_ATTEMPTS; i += 1) {
      vi.mocked(takeStock).mockImplementationOnce(noStock);
    }
    const before = await snapshotDatabase({ excludeTables: ["Session"] });

    const response = await postCheckout(user, { addressId, paymentMethod: "MOCK" });
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
    expect(vi.mocked(takeStock)).toHaveBeenCalledTimes(CHECKOUT_ATTEMPTS);
    expect(await stockOf(product.id)).toBe(5);
    expect(await cartLines(user.userId)).toEqual([{ productId: product.id, quantity: 2 }]);
    expect(await db.order.count({ where: { userId: user.userId } })).toBe(0);
    expect(diffSnapshots(before, await snapshotDatabase({ excludeTables: ["Session"] }))).toEqual(
      [],
    );

    // The key was not consumed: the same request, with the stock statement real again, buys.
    const retry = await postCheckout(user, { addressId, paymentMethod: "MOCK" });
    expect(retry.status).toBe(201);
    expect(await stockOf(product.id)).toBe(3);
  });
});

describe("a decline merges into a cart that was refilled meanwhile (BR-32)", () => {
  it("through checkout: the line returns capped at the stock, and the order records before and after", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 60 });
    const { addressId, cartId } = await readyToBuy(user, [{ productId: product.id, quantity: 50 }]);
    // The customer adds the same product in another tab while the provider is deciding.
    const provider: PaymentProvider = {
      name: "MOCK",
      isSimulated: true,
      charge: async () => {
        await createCartItem({ cartId, productId: product.id, quantity: 40 });
        return { outcome: "DECLINED", failureReason: "SIMULATED_DECLINE" };
      },
    };

    const result = await checkout(
      actorOf(user),
      newKey(),
      { addressId, paymentMethod: "MOCK", mockOutcome: "FAIL" },
      { provider },
    );
    expect(result.created).toBe(true);
    expect(result.order.paymentStatus).toBe("FAILED");
    // 40 in the cart + 50 returned = 90; the stock is back to 60, so the line is 60.
    expect(result.order.cartReturn).toEqual({
      capped: true,
      items: [{ productId: product.id, orderedQuantity: 50, cartQuantity: 60, capped: true }],
    });
    expect(await stockOf(product.id)).toBe(60);
    expect(await cartLines(user.userId)).toEqual([{ productId: product.id, quantity: 60 }]);
  });

  it("through checkout: a merged quantity above 99 is capped at 99 even when the stock is higher", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 500 });
    const { addressId, cartId } = await readyToBuy(user, [{ productId: product.id, quantity: 60 }]);
    const provider: PaymentProvider = {
      name: "MOCK",
      isSimulated: true,
      charge: async () => {
        await createCartItem({ cartId, productId: product.id, quantity: 70 });
        return { outcome: "DECLINED", failureReason: "SIMULATED_DECLINE" };
      },
    };
    const result = await checkout(
      actorOf(user),
      newKey(),
      { addressId, paymentMethod: "MOCK", mockOutcome: "FAIL" },
      { provider },
    );
    expect(result.order.cartReturn).toEqual({
      capped: true,
      items: [{ productId: product.id, orderedQuantity: 60, cartQuantity: 99, capped: true }],
    });
    expect(await cartLines(user.userId)).toEqual([{ productId: product.id, quantity: 99 }]);
    expect(await stockOf(product.id)).toBe(500);
  });
});

describe("payment finished by two paths at once (BR-20, DATA_MODEL.md section 7.3)", () => {
  /** A PENDING order, made overdue, for a fresh user: the provider never answered. */
  async function overdueOrder(stock: number, quantity: number) {
    const user = await signedIn();
    const product = await createProduct({ stock });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity }]);
    const silent: PaymentProvider = {
      name: "MOCK",
      isSimulated: true,
      charge: () => Promise.reject(new Error("no answer")),
    };
    const result = await checkout(
      actorOf(user),
      newKey(),
      { addressId, paymentMethod: "MOCK", mockOutcome: "SUCCESS" },
      { provider: silent },
    );
    expect(result.order.paymentStatus).toBe("PENDING");
    await db.$executeRaw`UPDATE "Order" SET "createdAt" = now() - interval '30 minutes' WHERE "id" = ${result.order.id}`;
    return { user, product, orderId: result.order.id, quantity, stock };
  }

  async function settled(orderId: string) {
    return db.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        paymentStatus: true,
        paidAt: true,
        payment: { select: { providerReference: true, failureReason: true } },
        sellerOrders: { select: { fulfilmentStatus: true } },
      },
    });
  }

  it("paid first: the sweep that follows fails nothing and restores nothing", async () => {
    const order = await overdueOrder(10, 4);
    expect(await completeOrderPayment(order.orderId, "MOCK-test-ref")).toBe(true);
    const swept = await failOverdueOrders(15);
    expect(swept).toEqual({ found: 0, failed: 0, errored: 0 });
    const stored = await settled(order.orderId);
    expect(stored.paymentStatus).toBe("PAID");
    expect(stored.payment?.failureReason).toBeNull();
    expect(await stockOf(order.product.id)).toBe(6);
    expect(await cartLines(order.user.userId)).toEqual([]);
  });

  it("swept first: a late confirmation changes nothing", async () => {
    const order = await overdueOrder(10, 4);
    expect(await failOverdueOrders(15)).toEqual({ found: 1, failed: 1, errored: 0 });
    expect(await completeOrderPayment(order.orderId, "MOCK-late")).toBe(false);
    const stored = await settled(order.orderId);
    expect(stored.paymentStatus).toBe("FAILED");
    expect(stored.paidAt).toBeNull();
    expect(stored.payment).toEqual({ providerReference: null, failureReason: "TIMEOUT" });
    expect(await stockOf(order.product.id)).toBe(10);
  });

  it("raced: each order ends PAID or FAILED, never both, and stock and cart agree with the outcome", async () => {
    const orders = [];
    for (let i = 0; i < 6; i += 1) orders.push(await overdueOrder(10, 3));

    const [paid] = await Promise.all([
      Promise.all(
        orders.map((order, i) => completeOrderPayment(order.orderId, `MOCK-race-${String(i)}`)),
      ),
      failOverdueOrders(15),
    ]);
    // A second sweep must find nothing left to do, whatever the first one lost.
    const second = await failOverdueOrders(15);
    expect(second.errored).toBe(0);

    for (const [i, order] of orders.entries()) {
      const stored = await settled(order.orderId);
      const cart = await cartLines(order.user.userId);
      if (stored.paymentStatus === "PAID") {
        expect(paid[i], `order ${String(i)} paid`).toBe(true);
        expect(stored.paidAt).not.toBeNull();
        expect(stored.payment?.failureReason).toBeNull();
        expect(stored.payment?.providerReference).toBe(`MOCK-race-${String(i)}`);
        expect(stored.sellerOrders.map((part) => part.fulfilmentStatus)).toEqual(["PENDING"]);
        expect(await stockOf(order.product.id)).toBe(order.stock - order.quantity);
        expect(cart).toEqual([]);
      } else {
        expect(stored.paymentStatus).toBe("FAILED");
        expect(paid[i], `order ${String(i)} paid`).toBe(false);
        expect(stored.paidAt).toBeNull();
        expect(stored.payment?.failureReason).toBe("TIMEOUT");
        expect(stored.sellerOrders.map((part) => part.fulfilmentStatus)).toEqual(["CANCELLED"]);
        // Restored exactly once: not still taken, not restored twice.
        expect(await stockOf(order.product.id)).toBe(order.stock);
        expect(cart).toEqual([{ productId: order.product.id, quantity: order.quantity }]);
      }
    }
  });

  it("raced against a decline: the second path to the order does nothing, stock restored once", async () => {
    const order = await overdueOrder(10, 4);
    const results = await Promise.all([
      failOrderPayment(order.orderId, "SIMULATED_DECLINE"),
      failOverdueOrders(15),
    ]);
    expect(results[0] === true || results[1].failed === 1).toBe(true);
    expect(await stockOf(order.product.id)).toBe(10);
    expect(await cartLines(order.user.userId)).toEqual([
      { productId: order.product.id, quantity: 4 },
    ]);
    expect((await settled(order.orderId)).paymentStatus).toBe("FAILED");
  });
});

describe("a decline while a second checkout of the same user holds the cart lock", () => {
  it("waits for the lock, finishes after it, and neither order is lost or double-restored", async () => {
    const user = await signedIn();
    const product = await createProduct({ priceSatang: 1_000, stock: 10 });
    const { addressId, cartId } = await readyToBuy(user, [{ productId: product.id, quantity: 3 }]);

    const inCharge = gate();
    const releaseDecline = gate();
    const declining: PaymentProvider = {
      name: "MOCK",
      isSimulated: true,
      charge: async () => {
        inCharge.open();
        await releaseDecline.promise;
        return { outcome: "DECLINED", failureReason: "SIMULATED_DECLINE" };
      },
    };
    const first = checkout(
      actorOf(user),
      newKey(),
      { addressId, paymentMethod: "MOCK", mockOutcome: "FAIL" },
      { provider: declining },
    );
    await inCharge.promise;
    // The first order is committed (stock 7, cart empty) and waits for the provider.
    expect(await stockOf(product.id)).toBe(7);
    expect(await cartLines(user.userId)).toEqual([]);

    // The customer shops again; the second checkout takes the cart lock and is held at its
    // stock statement.
    await createCartItem({ cartId, productId: product.id, quantity: 2 });
    const secondHolds = gate();
    const releaseSecond = gate();
    vi.mocked(takeStock).mockImplementationOnce(async (...args) => {
      secondHolds.open();
      await releaseSecond.promise;
      const real = await vi.importActual<typeof import("@/modules/checkout/repository")>(
        "@/modules/checkout/repository",
      );
      return real.takeStock(...args);
    });
    const second = checkout(
      actorOf(user),
      newKey(),
      { addressId, paymentMethod: "MOCK", mockOutcome: "SUCCESS" },
      {},
    );
    await secondHolds.promise;

    // The decline arrives while the lock is held: it must wait, not finish and not fail.
    releaseDecline.open();
    expect(await settlesWithin(first, 400)).toBe(false);
    // Still PENDING, and the second checkout has written no order yet.
    expect(await db.order.count({ where: { userId: user.userId } })).toBe(1);
    expect(await db.order.count({ where: { userId: user.userId, paymentStatus: "PENDING" } })).toBe(
      1,
    );
    expect(await stockOf(product.id)).toBe(7);

    releaseSecond.open();
    const [declined, bought] = await Promise.all([first, second]);

    expect(declined.order.paymentStatus).toBe("FAILED");
    expect(bought.order.paymentStatus).toBe("PAID");
    // 10 - 3 (first, restored) - 2 (second, kept) + 3 restored = 8.
    expect(await stockOf(product.id)).toBe(8);
    // The second checkout emptied the cart before the decline returned its 3 units.
    expect(await cartLines(user.userId)).toEqual([{ productId: product.id, quantity: 3 }]);
    expect(declined.order.cartReturn).toEqual({
      capped: false,
      items: [{ productId: product.id, orderedQuantity: 3, cartQuantity: 3, capped: false }],
    });
    expect(await db.order.count({ where: { userId: user.userId } })).toBe(2);
  });
});
