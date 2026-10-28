/**
 * T-031: `/api/v1/cart` and `/api/v1/cart/items*` against the worker's real test database
 * (docs/API_CONTRACTS.md section 5.4; REQ-C-10; BR-03, BR-16, BR-22, BR-30, BR-31, BR-38).
 *
 * Kinds (docs/TEST_STRATEGY.md): `GET /cart` is K3 (own data without an id); the item endpoints
 * are K4 (a resource by id: success, validation, 401, foreign id 404 and nothing changed). Races
 * are in concurrency.test.ts. Each case makes its own users, because the database is emptied
 * once per file, not per case.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";

import {
  createCartItem,
  createCategory,
  createProduct,
  createProductImage,
  createStore,
} from "../../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../../helpers/snapshot";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import {
  addItem,
  deleteItem,
  getCart,
  patchItem,
  sameAnswer,
  signedIn,
  storedLines,
} from "./support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

describe("authentication and origin", () => {
  it("every endpoint is 401 without a session and stores nothing", async () => {
    const product = await createProduct();
    const owner = await signedIn();
    const line = await createCartItem({
      cartId: (await db.cart.create({ data: { userId: owner.userId } })).id,
      productId: product.id,
      quantity: 2,
    });
    const before = await snapshotDatabase({ excludeTables: ["Session"] });

    expect((await getCart(null)).status).toBe(401);
    expect((await addItem(null, { productId: product.id, quantity: 1 })).status).toBe(401);
    expect((await patchItem(null, line.id, { quantity: 5 })).status).toBe(401);
    expect((await deleteItem(null, line.id)).status).toBe(401);

    const after = await snapshotDatabase({ excludeTables: ["Session"] });
    expect(diffSnapshots(before, after)).toEqual([]);
  });

  it("a deactivated user is 401", async () => {
    const user = await signedIn();
    await db.user.update({ where: { id: user.userId }, data: { isActive: false } });
    expect((await getCart(user)).status).toBe(401);
  });

  it("a foreign Origin is 403 on a write and nothing is stored", async () => {
    const user = await signedIn();
    const product = await createProduct();
    const response = await addItem(
      user,
      { productId: product.id, quantity: 1 },
      { origin: "https://evil.example" },
    );
    expect(response.status).toBe(403);
    expect(await storedLines(user.userId)).toEqual([]);
  });
});

describe("GET /api/v1/cart", () => {
  it("is an empty stores array, not an error, for a user with no cart", async () => {
    const user = await signedIn();
    const response = await getCart(user);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      stores: [],
      itemsSubtotalSatang: 0,
      shippingTotalSatang: 0,
      grandTotalSatang: 0,
      canCheckout: false,
    });
  });

  it("groups lines by store and computes the totals on the server, in satang", async () => {
    const user = await signedIn();
    const storeA = await createStore();
    const storeB = await createStore();
    const a = await createProduct({ storeId: storeA.id, priceSatang: 25_900 });
    const b = await createProduct({ storeId: storeB.id, priceSatang: 10_000 });
    const a2 = await createProduct({ storeId: storeA.id, priceSatang: 5_050 });
    expect((await addItem(user, { productId: a.id, quantity: 3 })).status).toBe(201);
    expect((await addItem(user, { productId: b.id, quantity: 1 })).status).toBe(201);
    expect((await addItem(user, { productId: a2.id, quantity: 2 })).status).toBe(201);

    const { status, body } = await getCart(user);
    expect(status).toBe(200);
    // Store A: 3 * 25900 + 2 * 5050 = 87800. Store B: 10000. Fee 4000 per store (settings row).
    expect(body.data.itemsSubtotalSatang).toBe(97_800);
    expect(body.data.shippingTotalSatang).toBe(8_000);
    expect(body.data.grandTotalSatang).toBe(105_800);
    expect(body.data.canCheckout).toBe(true);
    expect(body.data.stores).toHaveLength(2);
    const groupA = body.data.stores.find((group) => group.store.slug === storeA.slug);
    expect(groupA).toMatchObject({
      itemsSubtotalSatang: 87_800,
      shippingFeeSatang: 4_000,
      shippingFeeIsSimulated: true,
    });
    expect(groupA?.items.map((item) => item.lineTotalSatang).sort()).toEqual([10_100, 77_700]);
  });

  it("uses the current price and fee: a change in the database shows at the next read", async () => {
    const user = await signedIn();
    const product = await createProduct({ priceSatang: 10_000 });
    await addItem(user, { productId: product.id, quantity: 2 });
    await db.product.update({ where: { id: product.id }, data: { priceSatang: 12_345 } });
    await db.marketplaceSettings.update({
      where: { id: 1 },
      data: { flatShippingFeeSatang: 5_500 },
    });
    try {
      const { body } = await getCart(user);
      expect(body.data.itemsSubtotalSatang).toBe(24_690);
      expect(body.data.shippingTotalSatang).toBe(5_500);
      expect(body.data.grandTotalSatang).toBe(30_190);
    } finally {
      await db.marketplaceSettings.update({
        where: { id: 1 },
        data: { flatShippingFeeSatang: 4_000 },
      });
    }
  });

  it("shows only the caller's own cart", async () => {
    const mine = await signedIn();
    const theirs = await signedIn();
    const product = await createProduct();
    await addItem(theirs, { productId: product.id, quantity: 4 });
    const { body } = await getCart(mine);
    expect(body.data.stores).toEqual([]);
  });

  it("keeps a sold-out and a hidden line, flags them, and counts neither in any total", async () => {
    const user = await signedIn();
    const visible = await createProduct({ priceSatang: 10_000 });
    const soldOut = await createProduct({ priceSatang: 20_000 });
    const hidden = await createProduct({ priceSatang: 30_000 });
    await addItem(user, { productId: visible.id, quantity: 1 });
    await addItem(user, { productId: soldOut.id, quantity: 1 });
    await addItem(user, { productId: hidden.id, quantity: 1 });
    await db.product.update({ where: { id: soldOut.id }, data: { stock: 0 } });
    await db.product.update({ where: { id: hidden.id }, data: { status: "ARCHIVED" } });

    const { body } = await getCart(user);
    const lines = body.data.stores.flatMap((group) => group.items);
    const byProduct = (id: string) => lines.find((line) => line.productId === id);
    expect(byProduct(soldOut.id)).toMatchObject({
      buyable: false,
      unbuyableReason: "SOLD_OUT",
      stock: 0,
    });
    expect(byProduct(hidden.id)).toMatchObject({
      buyable: false,
      unbuyableReason: "NOT_AVAILABLE",
      unitPriceSatang: null,
      lineTotalSatang: null,
      stock: null,
    });
    expect(byProduct(visible.id)).toMatchObject({ buyable: true, unbuyableReason: null });
    expect(body.data.itemsSubtotalSatang).toBe(10_000);
    expect(body.data.canCheckout).toBe(false);
  });

  it("sends no title, slug, or picture of a hidden product, edited or taken down (SEC-054)", async () => {
    const user = await signedIn();
    const store = await createStore();
    const edited = await createProduct({ storeId: store.id, title: "Approved title" });
    const takenDown = await createProduct({ storeId: store.id, title: "Taken down title" });
    const soldOut = await createProduct({ storeId: store.id, title: "Sold out title" });
    for (const product of [edited, takenDown, soldOut]) {
      await createProductImage({ productId: product.id });
      expect((await addItem(user, { productId: product.id, quantity: 1 })).status).toBe(201);
    }
    // A seller edit after approval (OQ-05): new text and slug, hidden until re-approved.
    await db.product.update({
      where: { id: edited.id },
      data: {
        title: "Unapproved text from the seller",
        slug: `unapproved-${edited.id}`,
        moderationStatus: "PENDING",
      },
    });
    await db.product.update({
      where: { id: takenDown.id },
      data: { moderationStatus: "TAKEN_DOWN" },
    });
    await db.product.update({ where: { id: soldOut.id }, data: { stock: 0 } });
    const keys = await db.productImage.findMany({
      where: { productId: { in: [edited.id, takenDown.id] } },
      select: { upload: { select: { storageKey: true } } },
    });

    const { status, body } = await getCart(user);
    expect(status).toBe(200);
    const group = body.data.stores.find((entry) => entry.store.slug === store.slug);
    expect(group?.store.name).toBe(store.name);
    const byProduct = (id: string) => group?.items.find((line) => line.productId === id);
    for (const id of [edited.id, takenDown.id]) {
      expect(byProduct(id)).toMatchObject({
        unbuyableReason: "NOT_AVAILABLE",
        slug: null,
        title: null,
        image: null,
        unitPriceSatang: null,
        stock: null,
      });
    }
    // A sold-out product is visible: its content stays.
    expect(byProduct(soldOut.id)).toMatchObject({
      unbuyableReason: "SOLD_OUT",
      slug: soldOut.slug,
      title: "Sold out title",
    });
    expect(byProduct(soldOut.id)?.image).not.toBeNull();
    const text = JSON.stringify(body);
    expect(text).not.toContain("Unapproved text from the seller");
    expect(text).not.toContain(`unapproved-${edited.id}`);
    expect(text).not.toContain("Taken down title");
    // Followed by the closing quote, so `test-upload-1` does not match `test-upload-12`.
    for (const key of keys) expect(text).not.toContain(`${key.upload.storageKey}"`);

    // The hidden line can still be removed by its id.
    const hiddenLine = byProduct(edited.id);
    if (hiddenLine === undefined) throw new Error("expected the hidden line");
    expect((await deleteItem(user, hiddenLine.id)).status).toBe(200);
  });

  it("writes nothing, not even for a line above the stock, and the lowering is not stored", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 10 });
    const line = await createCartItem({
      cartId: (await db.cart.create({ data: { userId: user.userId } })).id,
      productId: product.id,
      quantity: 95,
    });
    await db.product.update({ where: { id: product.id }, data: { stock: 2 } });
    const before = await snapshotDatabase({ excludeTables: ["Session"] });

    const first = await getCart(user);
    const second = await getCart(user);

    expect(first.body.data.stores[0]?.items[0]).toMatchObject({
      quantity: 2,
      quantityLowered: true,
      lineTotalSatang: 20_000,
    });
    expect(second.body).toEqual(first.body);
    expect(diffSnapshots(before, await snapshotDatabase({ excludeTables: ["Session"] }))).toEqual(
      [],
    );
    expect(await db.cartItem.findUniqueOrThrow({ where: { id: line.id } })).toMatchObject({
      quantity: 95,
    });
  });

  it("does not create a cart for a user who has none", async () => {
    const user = await signedIn();
    await getCart(user);
    expect(await db.cart.count({ where: { userId: user.userId } })).toBe(0);
  });
});

describe("POST /api/v1/cart/items", () => {
  it("creates a line (201) and adds to it on a second add (200); stock is not touched", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 10, priceSatang: 25_900 });
    const first = await addItem(user, { productId: product.id, quantity: 2 });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({
      productId: product.id,
      quantity: 2,
      requestedQuantity: 2,
      quantityLowered: false,
      unitPriceSatang: 25_900,
      lineTotalSatang: 51_800,
      buyable: true,
    });
    const second = await addItem(user, { productId: product.id, quantity: 3 });
    expect(second.status).toBe(200);
    expect(second.body.data).toMatchObject({
      id: first.body.data.id,
      quantity: 5,
      requestedQuantity: 5,
    });
    expect(await storedLines(user.userId)).toEqual([
      { id: first.body.data.id, productId: product.id, quantity: 5 },
    ]);
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(10);
  });

  it("lowers a quantity above the stock to the stock and says so (BR-31 (2))", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 2 });
    const response = await addItem(user, { productId: product.id, quantity: 5 });
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      quantity: 2,
      requestedQuantity: 5,
      quantityLowered: true,
    });
    expect((await storedLines(user.userId))[0]?.quantity).toBe(2);
  });

  it("sums the stored quantity, not the lowered one: stored 95, stock 2, add 5 is 400 (CR-T031-05)", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 2 });
    const cart = await db.cart.create({ data: { userId: user.userId } });
    const line = await createCartItem({ cartId: cart.id, productId: product.id, quantity: 95 });
    const response = await addItem(user, { productId: product.id, quantity: 5 });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(await storedLines(user.userId)).toEqual([
      { id: line.id, productId: product.id, quantity: 95 },
    ]);
  });

  it("refuses a sold-out product with 409 INSUFFICIENT_STOCK and creates nothing", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 0 });
    const response = await addItem(user, { productId: product.id, quantity: 2 });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("INSUFFICIENT_STOCK");
    expect(response.body.error.details.items).toEqual([
      {
        cartItemId: null,
        productId: product.id,
        reason: "INSUFFICIENT_STOCK",
        requestedQuantity: 2,
        availableStock: 0,
      },
    ]);
    expect(await storedLines(user.userId)).toEqual([]);
  });

  it("answers a hidden product exactly like a missing one: 404, resource product, no line", async () => {
    const user = await signedIn();
    const category = await createCategory({ isActive: false });
    const hiddenProducts = [
      await createProduct({ status: "DRAFT" }),
      await createProduct({ status: "ARCHIVED" }),
      await createProduct({ moderationStatus: "PENDING" }),
      await createProduct({ moderationStatus: "REJECTED" }),
      await createProduct({ categoryId: category.id }),
      await createProduct({ storeId: (await createStore({ status: "SUSPENDED" })).id }),
    ];
    const missing = await addItem(user, { productId: "no-such-product", quantity: 1 });
    expect(missing.status).toBe(404);
    expect(missing.body.error.details).toEqual({ resource: "product" });
    for (const product of hiddenProducts) {
      const response = await addItem(user, { productId: product.id, quantity: 1 });
      expect(response.status).toBe(404);
      expect(sameAnswer(response.body.error)).toEqual(sameAnswer(missing.body.error));
    }
    expect(await storedLines(user.userId)).toEqual([]);
  });

  it("refuses the seller's own store product with 409 OWN_STORE and a null cartItemId (BR-16)", async () => {
    const seller = await signedIn("SELLER");
    const store = await createStore({ ownerId: seller.userId });
    const own = await createProduct({ storeId: store.id });
    const response = await addItem(seller, { productId: own.id, quantity: 3 });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("PRODUCT_UNAVAILABLE");
    expect(response.body.error.details.items).toEqual([
      {
        cartItemId: null,
        productId: own.id,
        reason: "OWN_STORE",
        requestedQuantity: 3,
        availableStock: null,
      },
    ]);
    expect(await storedLines(seller.userId)).toEqual([]);

    // Another store's product is fine for the same seller.
    const foreign = await createProduct();
    expect((await addItem(seller, { productId: foreign.id, quantity: 1 })).status).toBe(201);
  });

  it("OWN_STORE keeps cartItemId null when the seller still holds an older line (CR-T031-03)", async () => {
    const seller = await signedIn("SELLER");
    const store = await createStore({ ownerId: seller.userId });
    const own = await createProduct({ storeId: store.id });
    const cart = await db.cart.create({ data: { userId: seller.userId } });
    const line = await createCartItem({ cartId: cart.id, productId: own.id, quantity: 2 });
    const response = await addItem(seller, { productId: own.id, quantity: 1 });
    expect(response.status).toBe(409);
    expect(response.body.error.details.items?.[0]).toMatchObject({
      cartItemId: null,
      reason: "OWN_STORE",
      requestedQuantity: 3,
    });
    expect(await storedLines(seller.userId)).toEqual([
      { id: line.id, productId: own.id, quantity: 2 },
    ]);
  });

  it("refuses a seller's add of an own product that is hidden with 404 (CR-T031-07)", async () => {
    const seller = await signedIn("SELLER");
    const store = await createStore({ ownerId: seller.userId });
    const own = await createProduct({ storeId: store.id, status: "DRAFT" });
    const response = await addItem(seller, { productId: own.id, quantity: 1 });
    expect(response.status).toBe(404);
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["above the cap", 100],
    ["a string", "2"],
    ["null", null],
    ["huge", 1e21],
  ])("refuses a quantity that is %s and stores nothing", async (_name, quantity) => {
    const user = await signedIn();
    const product = await createProduct();
    const response = await addItem(user, { productId: product.id, quantity });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(await db.cart.count({ where: { userId: user.userId } })).toBe(0);
  });

  it("accepts the bounds 1 and 99", async () => {
    const user = await signedIn();
    const a = await createProduct({ stock: 200 });
    const b = await createProduct({ stock: 200 });
    expect((await addItem(user, { productId: a.id, quantity: 1 })).status).toBe(201);
    expect((await addItem(user, { productId: b.id, quantity: 99 })).status).toBe(201);
    const over = await addItem(user, { productId: b.id, quantity: 1 });
    expect(over.status).toBe(400);
    expect((await storedLines(user.userId)).map((line) => line.quantity).sort()).toEqual([1, 99]);
  });

  it.each([
    ["a price", { price: 1 }],
    ["a unit price", { unitPriceSatang: 1 }],
    ["a total", { grandTotalSatang: 1 }],
    ["a userId", { userId: "someone-else" }],
    ["a storeId", { storeId: "x" }],
    ["a cartId", { cartId: "x" }],
  ])("refuses %s in the body as an unknown key and stores nothing", async (_name, extra) => {
    const user = await signedIn();
    const victim = await signedIn();
    const product = await createProduct();
    const response = await addItem(user, { productId: product.id, quantity: 1, ...extra });
    expect(response.status).toBe(400);
    expect(await storedLines(user.userId)).toEqual([]);
    expect(await db.cart.count({ where: { userId: victim.userId } })).toBe(0);
  });

  it("refuses a missing productId and a missing quantity", async () => {
    const user = await signedIn();
    expect((await addItem(user, { quantity: 1 })).status).toBe(400);
    expect((await addItem(user, { productId: "x" })).status).toBe(400);
    expect((await addItem(user, {})).status).toBe(400);
  });
});

describe("PATCH /api/v1/cart/items/{itemId}", () => {
  it("sets the quantity of the caller's own line", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 10 });
    const created = await addItem(user, { productId: product.id, quantity: 2 });
    const response = await patchItem(user, created.body.data.id, { quantity: 7 });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ quantity: 7, requestedQuantity: 7 });
    expect((await storedLines(user.userId))[0]?.quantity).toBe(7);
  });

  it("sets, not adds: a lower value lowers the line", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 10 });
    const created = await addItem(user, { productId: product.id, quantity: 5 });
    await patchItem(user, created.body.data.id, { quantity: 1 });
    expect((await storedLines(user.userId))[0]?.quantity).toBe(1);
  });

  it("lowers a quantity above the stock to the stock and stores it", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 3 });
    const created = await addItem(user, { productId: product.id, quantity: 1 });
    const response = await patchItem(user, created.body.data.id, { quantity: 9 });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      quantity: 3,
      requestedQuantity: 9,
      quantityLowered: true,
    });
    expect((await storedLines(user.userId))[0]?.quantity).toBe(3);
  });

  it("repairs a stored 95 above stock by storing the new quantity (CR-T031-05)", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 2 });
    const cart = await db.cart.create({ data: { userId: user.userId } });
    const line = await createCartItem({ cartId: cart.id, productId: product.id, quantity: 95 });
    const response = await patchItem(user, line.id, { quantity: 2 });
    expect(response.status).toBe(200);
    expect((await storedLines(user.userId))[0]?.quantity).toBe(2);
  });

  it("is 409 INSUFFICIENT_STOCK on a sold-out line and leaves it unchanged", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 5 });
    const created = await addItem(user, { productId: product.id, quantity: 2 });
    await db.product.update({ where: { id: product.id }, data: { stock: 0 } });
    const response = await patchItem(user, created.body.data.id, { quantity: 4 });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("INSUFFICIENT_STOCK");
    expect(response.body.error.details.items?.[0]).toMatchObject({
      cartItemId: created.body.data.id,
      reason: "INSUFFICIENT_STOCK",
      requestedQuantity: 4,
      availableStock: 0,
    });
    expect((await storedLines(user.userId))[0]?.quantity).toBe(2);
  });

  it("is 409 NOT_AVAILABLE on a hidden line, also when it has no stock, and leaves it unchanged (BR-38)", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 5 });
    const created = await addItem(user, { productId: product.id, quantity: 2 });
    await db.product.update({
      where: { id: product.id },
      data: { status: "ARCHIVED", stock: 0 },
    });
    const response = await patchItem(user, created.body.data.id, { quantity: 4 });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("PRODUCT_UNAVAILABLE");
    expect(response.body.error.details.items).toEqual([
      {
        cartItemId: created.body.data.id,
        productId: product.id,
        reason: "NOT_AVAILABLE",
        requestedQuantity: 4,
        availableStock: null,
      },
    ]);
    expect((await storedLines(user.userId))[0]?.quantity).toBe(2);
  });

  it.each([0, -1, 1.5, 100, "3"])(
    "refuses quantity %j and leaves the line unchanged",
    async (quantity) => {
      const user = await signedIn();
      const product = await createProduct();
      const created = await addItem(user, { productId: product.id, quantity: 2 });
      const response = await patchItem(user, created.body.data.id, { quantity });
      expect(response.status).toBe(400);
      expect((await storedLines(user.userId))[0]?.quantity).toBe(2);
    },
  );

  it("refuses unknown keys and an empty body", async () => {
    const user = await signedIn();
    const product = await createProduct();
    const created = await addItem(user, { productId: product.id, quantity: 2 });
    for (const body of [{ quantity: 3, productId: "x" }, { quantity: 3, price: 1 }, {}]) {
      expect((await patchItem(user, created.body.data.id, body)).status).toBe(400);
    }
    expect((await storedLines(user.userId))[0]?.quantity).toBe(2);
  });

  it("another user's line is 404, identical to an unknown id, and is unchanged (IDOR)", async () => {
    const owner = await signedIn();
    const intruder = await signedIn();
    const product = await createProduct({ stock: 10 });
    const created = await addItem(owner, { productId: product.id, quantity: 2 });
    const lineId = created.body.data.id;
    // Case 1: the intruder has no cart. Case 2: the intruder has a cart of their own.
    const other = await createProduct();
    const noCart = await patchItem(intruder, lineId, { quantity: 9 });
    const unknownNoCart = await patchItem(intruder, "no-such-line", { quantity: 9 });
    await addItem(intruder, { productId: other.id, quantity: 1 });
    const withCart = await patchItem(intruder, lineId, { quantity: 9 });
    const unknownWithCart = await patchItem(intruder, "no-such-line", { quantity: 9 });

    for (const response of [noCart, unknownNoCart, withCart, unknownWithCart]) {
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
    }
    expect(sameAnswer(withCart.body.error)).toEqual(sameAnswer(unknownWithCart.body.error));
    expect(sameAnswer(noCart.body.error)).toEqual(sameAnswer(unknownNoCart.body.error));
    expect(await storedLines(owner.userId)).toEqual([
      { id: lineId, productId: product.id, quantity: 2 },
    ]);
    expect((await storedLines(intruder.userId)).map((line) => line.productId)).toEqual([other.id]);
  });
});

describe("DELETE /api/v1/cart/items/{itemId}", () => {
  it("removes the caller's own line; a second delete is 404; the product is untouched", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 4 });
    const created = await addItem(user, { productId: product.id, quantity: 2 });
    const first = await deleteItem(user, created.body.data.id);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ data: { deleted: true } });
    expect(await storedLines(user.userId)).toEqual([]);
    expect((await deleteItem(user, created.body.data.id)).status).toBe(404);
    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({
      stock: 4,
    });
  });

  it("another user's line is 404 and stays, exactly like an unknown id (IDOR)", async () => {
    const owner = await signedIn();
    const intruder = await signedIn();
    const product = await createProduct();
    const created = await addItem(owner, { productId: product.id, quantity: 2 });
    const lineId = created.body.data.id;
    const foreign = await deleteItem(intruder, lineId);
    const unknown = await deleteItem(intruder, "no-such-line");
    expect(foreign.status).toBe(404);
    expect(sameAnswer(foreign.body.error)).toEqual(sameAnswer(unknown.body.error));
    expect(await storedLines(owner.userId)).toEqual([
      { id: lineId, productId: product.id, quantity: 2 },
    ]);

    // With a cart of their own, still 404 and the owner's line stays.
    await addItem(intruder, { productId: (await createProduct()).id, quantity: 1 });
    expect((await deleteItem(intruder, lineId)).status).toBe(404);
    expect(await storedLines(owner.userId)).toHaveLength(1);
  });

  it("removes a sold-out and a hidden line (BR-38)", async () => {
    const user = await signedIn();
    const soldOut = await createProduct();
    const hidden = await createProduct();
    const a = await addItem(user, { productId: soldOut.id, quantity: 1 });
    const b = await addItem(user, { productId: hidden.id, quantity: 1 });
    await db.product.update({ where: { id: soldOut.id }, data: { stock: 0 } });
    await db.product.update({ where: { id: hidden.id }, data: { status: "ARCHIVED" } });
    expect((await deleteItem(user, a.body.data.id)).status).toBe(200);
    expect((await deleteItem(user, b.body.data.id)).status).toBe(200);
    expect(await storedLines(user.userId)).toEqual([]);
  });

  it("refuses an id with U+0000 or above the length bound with 400", async () => {
    const user = await signedIn();
    expect((await deleteItem(user, "a\u0000b")).status).toBe(400);
    expect((await deleteItem(user, "x".repeat(201))).status).toBe(400);
  });
});
