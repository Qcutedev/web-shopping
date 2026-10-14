/**
 * The cart service against a mocked repository: the order of checks of each write, what is
 * refused and with which error, what is stored, and that every query is scoped by the actor.
 * The same behaviour against a real PostgreSQL database, the transaction and the cart lock
 * included, is in tests/integration/cart.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Actor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";

import * as repository from "./repository";
import { addCartItem, deleteCartItem, getCart, isOwnStore, updateCartItem } from "./service";

vi.mock("./repository", () => ({
  findCartLines: vi.fn(),
  findVisibleProductIds: vi.fn(),
  readFlatShippingFee: vi.fn(),
  findFirstImageKey: vi.fn(),
  inCartTransaction: vi.fn(),
  findVisibleProduct: vi.fn(),
  findLineInCart: vi.fn(),
  findLineForProduct: vi.fn(),
  insertLine: vi.fn(),
  setLineQuantity: vi.fn(),
  deleteLineInCart: vi.fn(),
}));

const repo = vi.mocked(repository);
const TX = { marker: "tx" } as unknown as Parameters<typeof repository.insertLine>[0];
const CART_ID = "cart_me";

const CUSTOMER: Actor = Object.freeze({
  userId: "user_me",
  role: "CUSTOMER",
  storeId: null,
  storeStatus: null,
});
const SELLER: Actor = Object.freeze({
  userId: "user_seller",
  role: "SELLER",
  storeId: "store_own",
  storeStatus: "APPROVED",
});

const PRODUCT = {
  id: "product_1",
  slug: "product-1",
  title: "สินค้า",
  priceSatang: 25_900,
  stock: 10,
  storeId: "store_other",
};

/** Lets the mocked transaction run its callback, as the real one does when a cart exists. */
function cartExists(exists = true) {
  repo.inCartTransaction.mockImplementation(async (_userId, options, work) => {
    if (!exists && !options.createCart) return null;
    return work(TX, CART_ID);
  });
}

async function refusal(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("expected a refusal");
}

beforeEach(() => {
  vi.resetAllMocks();
  cartExists();
  repo.findFirstImageKey.mockResolvedValue(null);
  repo.findVisibleProduct.mockResolvedValue(PRODUCT);
  repo.findLineForProduct.mockResolvedValue(null);
  repo.insertLine.mockImplementation(async (_tx, _cart, productId, quantity) => ({
    id: "line_new",
    productId,
    quantity,
  }));
  repo.setLineQuantity.mockImplementation(async (_tx, _cart, lineId, quantity) => ({
    id: lineId,
    productId: PRODUCT.id,
    quantity,
  }));
});

describe("isOwnStore (BR-16)", () => {
  it("is true only for the actor's own store id", () => {
    expect(isOwnStore(SELLER, "store_own")).toBe(true);
    expect(isOwnStore(SELLER, "store_other")).toBe(false);
    expect(isOwnStore(CUSTOMER, "store_own")).toBe(false);
  });
});

describe("getCart", () => {
  it("reads the actor's own lines, their visibility, and the fee, and prices them", async () => {
    repo.findCartLines.mockResolvedValue([
      {
        id: "line_1",
        productId: "product_1",
        quantity: 2,
        product: {
          slug: "p1",
          title: "หนึ่ง",
          priceSatang: 1_000,
          stock: 5,
          store: { id: "s1", name: "ร้าน", slug: "s1", isSample: false },
          images: [{ upload: { storageKey: "k1" } }],
        },
      },
      {
        id: "line_2",
        productId: "product_2",
        quantity: 1,
        product: {
          slug: "p2",
          title: "สอง",
          priceSatang: 9_999,
          stock: 5,
          store: { id: "s1", name: "ร้าน", slug: "s1", isSample: false },
          images: [],
        },
      },
    ]);
    repo.findVisibleProductIds.mockResolvedValue(new Set(["product_1"]));
    repo.readFlatShippingFee.mockResolvedValue(4_000);

    const cart = await getCart(CUSTOMER);

    expect(repo.findCartLines).toHaveBeenCalledWith("user_me");
    expect(repo.findVisibleProductIds).toHaveBeenCalledWith(["product_1", "product_2"]);
    expect(cart.stores).toHaveLength(1);
    expect(cart.stores[0]?.items.map((item) => item.unbuyableReason)).toEqual([
      null,
      "NOT_AVAILABLE",
    ]);
    expect(cart.stores[0]?.items[0]?.image).toEqual({ key: "k1", url: "/api/files/k1" });
    expect(cart).toMatchObject({
      itemsSubtotalSatang: 2_000,
      shippingTotalSatang: 4_000,
      grandTotalSatang: 6_000,
      canCheckout: false,
    });
  });

  it("opens no transaction: a read writes nothing and takes no lock", async () => {
    repo.findCartLines.mockResolvedValue([]);
    repo.findVisibleProductIds.mockResolvedValue(new Set());
    repo.readFlatShippingFee.mockResolvedValue(4_000);
    await getCart(CUSTOMER);
    expect(repo.inCartTransaction).not.toHaveBeenCalled();
    expect(repo.insertLine).not.toHaveBeenCalled();
    expect(repo.setLineQuantity).not.toHaveBeenCalled();
  });
});

describe("addCartItem", () => {
  it("creates a line in the actor's cart, creating the cart if needed, and answers created", async () => {
    const result = await addCartItem(CUSTOMER, { productId: "product_1", quantity: 3 });
    expect(repo.inCartTransaction).toHaveBeenCalledWith(
      "user_me",
      { createCart: true },
      expect.any(Function),
    );
    expect(repo.insertLine).toHaveBeenCalledWith(TX, CART_ID, "product_1", 3);
    expect(result.created).toBe(true);
    expect(result.line).toMatchObject({
      id: "line_new",
      quantity: 3,
      requestedQuantity: 3,
      quantityLowered: false,
      unitPriceSatang: 25_900,
      lineTotalSatang: 77_700,
      buyable: true,
      unbuyableReason: null,
      stock: 10,
    });
  });

  it("adds to an existing line and answers not created", async () => {
    repo.findLineForProduct.mockResolvedValue({
      id: "line_1",
      productId: "product_1",
      quantity: 4,
    });
    const result = await addCartItem(CUSTOMER, { productId: "product_1", quantity: 3 });
    expect(repo.setLineQuantity).toHaveBeenCalledWith(TX, CART_ID, "line_1", 7);
    expect(repo.insertLine).not.toHaveBeenCalled();
    expect(result.created).toBe(false);
    expect(result.line).toMatchObject({ quantity: 7, requestedQuantity: 7 });
  });

  it("stores the stock and reports quantityLowered when the request asks for more (BR-31 (2))", async () => {
    repo.findVisibleProduct.mockResolvedValue({ ...PRODUCT, stock: 3 });
    repo.findLineForProduct.mockResolvedValue({
      id: "line_1",
      productId: "product_1",
      quantity: 2,
    });
    const result = await addCartItem(CUSTOMER, { productId: "product_1", quantity: 3 });
    expect(repo.setLineQuantity).toHaveBeenCalledWith(TX, CART_ID, "line_1", 3);
    expect(result.line).toMatchObject({
      quantity: 3,
      requestedQuantity: 5,
      stock: 3,
      quantityLowered: true,
      lineTotalSatang: 77_700,
    });
  });

  it("answers 404 with resource product for a missing or hidden product, and stores nothing", async () => {
    repo.findVisibleProduct.mockResolvedValue(null);
    const error = await refusal(addCartItem(CUSTOMER, { productId: "nope", quantity: 1 }));
    expect(error.toPublic()).toEqual({
      code: "NOT_FOUND",
      message: "The resource was not found.",
      details: { resource: "product" },
    });
    expect(repo.insertLine).not.toHaveBeenCalled();
    expect(repo.setLineQuantity).not.toHaveBeenCalled();
  });

  it("refuses a product of the actor's own store with 409 OWN_STORE (BR-16)", async () => {
    repo.findVisibleProduct.mockResolvedValue({ ...PRODUCT, storeId: "store_own" });
    const error = await refusal(addCartItem(SELLER, { productId: "product_1", quantity: 2 }));
    expect(error.status).toBe(409);
    expect(error.toPublic()).toMatchObject({
      code: "PRODUCT_UNAVAILABLE",
      details: {
        items: [
          {
            cartItemId: null,
            productId: "product_1",
            reason: "OWN_STORE",
            requestedQuantity: 2,
            availableStock: null,
          },
        ],
      },
    });
    expect(repo.insertLine).not.toHaveBeenCalled();
  });

  it("names no line in OWN_STORE even when the seller holds one for the product (CR-T031-03)", async () => {
    repo.findVisibleProduct.mockResolvedValue({ ...PRODUCT, storeId: "store_own" });
    repo.findLineForProduct.mockResolvedValue({
      id: "line_old",
      productId: "product_1",
      quantity: 1,
    });
    const error = await refusal(addCartItem(SELLER, { productId: "product_1", quantity: 2 }));
    expect(error.details).toMatchObject({
      items: [{ cartItemId: null, productId: "product_1", reason: "OWN_STORE" }],
    });
    expect(repo.setLineQuantity).not.toHaveBeenCalled();
    expect(repo.insertLine).not.toHaveBeenCalled();
  });

  it("reports the resulting quantity in OWN_STORE, like every other add answer (CR-T031-04)", async () => {
    repo.findVisibleProduct.mockResolvedValue({ ...PRODUCT, storeId: "store_own" });
    repo.findLineForProduct.mockResolvedValue({
      id: "line_old",
      productId: "product_1",
      quantity: 4,
    });
    const error = await refusal(addCartItem(SELLER, { productId: "product_1", quantity: 2 }));
    expect(error.details).toMatchObject({
      items: [{ reason: "OWN_STORE", requestedQuantity: 6 }],
    });
  });

  it("lets a seller add another store's product", async () => {
    const result = await addCartItem(SELLER, { productId: "product_1", quantity: 1 });
    expect(result.created).toBe(true);
  });

  it("refuses an add that would pass 99 with 400 on quantity, before looking at stock (BR-31 (3))", async () => {
    repo.findVisibleProduct.mockResolvedValue({ ...PRODUCT, stock: 0 });
    repo.findLineForProduct.mockResolvedValue({
      id: "line_1",
      productId: "product_1",
      quantity: 98,
    });
    const error = await refusal(addCartItem(CUSTOMER, { productId: "product_1", quantity: 2 }));
    expect(error.toPublic()).toMatchObject({
      code: "VALIDATION_ERROR",
      details: { fields: [{ path: "quantity", code: "too_big" }] },
    });
    expect(repo.setLineQuantity).not.toHaveBeenCalled();
  });

  it("accepts an add that brings the line to exactly 99", async () => {
    repo.findVisibleProduct.mockResolvedValue({ ...PRODUCT, stock: 1_000 });
    repo.findLineForProduct.mockResolvedValue({
      id: "line_1",
      productId: "product_1",
      quantity: 98,
    });
    const result = await addCartItem(CUSTOMER, { productId: "product_1", quantity: 1 });
    expect(result.line.quantity).toBe(99);
  });

  it("refuses a sold-out product with 409 INSUFFICIENT_STOCK, availableStock 0 (BR-31 (1))", async () => {
    repo.findVisibleProduct.mockResolvedValue({ ...PRODUCT, stock: 0 });
    const error = await refusal(addCartItem(CUSTOMER, { productId: "product_1", quantity: 2 }));
    expect(error.toPublic()).toMatchObject({
      code: "INSUFFICIENT_STOCK",
      details: {
        items: [
          {
            cartItemId: null,
            productId: "product_1",
            reason: "INSUFFICIENT_STOCK",
            requestedQuantity: 2,
            availableStock: 0,
          },
        ],
      },
    });
    expect(repo.insertLine).not.toHaveBeenCalled();
  });

  it("names the existing line when a sold-out product already has one, and leaves it", async () => {
    repo.findVisibleProduct.mockResolvedValue({ ...PRODUCT, stock: 0 });
    repo.findLineForProduct.mockResolvedValue({
      id: "line_1",
      productId: "product_1",
      quantity: 2,
    });
    const error = await refusal(addCartItem(CUSTOMER, { productId: "product_1", quantity: 1 }));
    expect(error.details).toMatchObject({
      items: [{ cartItemId: "line_1", requestedQuantity: 3, availableStock: 0 }],
    });
    expect(repo.setLineQuantity).not.toHaveBeenCalled();
  });

  it("answers 404 product when the product is deleted before the insert (CR-T031-02)", async () => {
    repo.insertLine.mockResolvedValue(null);
    const error = await refusal(addCartItem(CUSTOMER, { productId: "product_1", quantity: 1 }));
    expect(error.toPublic()).toEqual({
      code: "NOT_FOUND",
      message: "The resource was not found.",
      details: { resource: "product" },
    });
    expect(repo.findFirstImageKey).not.toHaveBeenCalled();
  });

  it("answers 404 product when a product delete removed the existing line (CR-T031-02)", async () => {
    repo.findLineForProduct.mockResolvedValue({
      id: "line_1",
      productId: "product_1",
      quantity: 2,
    });
    repo.setLineQuantity.mockResolvedValue(null);
    const error = await refusal(addCartItem(CUSTOMER, { productId: "product_1", quantity: 1 }));
    expect(error.status).toBe(404);
    expect(error.toPublic().details).toEqual({ resource: "product" });
  });
});

describe("the picture of a write's response (CR-T031-06)", () => {
  /** Runs the callback like the real transaction and records whether it threw before committing. */
  function trackRollback(): { rolledBack: boolean } {
    const state = { rolledBack: false };
    repo.inCartTransaction.mockImplementation(async (_userId, _options, work) => {
      try {
        return await work(TX, CART_ID);
      } catch (error) {
        state.rolledBack = true;
        throw error;
      }
    });
    return state;
  }

  it("reads the image key inside the add's transaction and answers with it", async () => {
    repo.findFirstImageKey.mockResolvedValue("k1");
    const result = await addCartItem(CUSTOMER, { productId: "product_1", quantity: 1 });
    expect(repo.findFirstImageKey).toHaveBeenCalledWith(TX, "product_1");
    expect(result.line.image).toEqual({ key: "k1", url: "/api/files/k1" });
  });

  it("rolls the add back when the image read fails, so a retry cannot add twice", async () => {
    const state = trackRollback();
    repo.findFirstImageKey.mockRejectedValue(new Error("connection lost"));
    await expect(addCartItem(CUSTOMER, { productId: "product_1", quantity: 1 })).rejects.toThrow(
      "connection lost",
    );
    expect(state.rolledBack).toBe(true);
  });

  it("reads the image key inside the quantity change's transaction", async () => {
    const state = trackRollback();
    repo.findLineInCart.mockResolvedValue({ id: "line_1", productId: "product_1", quantity: 2 });
    repo.findFirstImageKey.mockRejectedValue(new Error("connection lost"));
    await expect(updateCartItem(CUSTOMER, "line_1", { quantity: 3 })).rejects.toThrow(
      "connection lost",
    );
    expect(repo.findFirstImageKey).toHaveBeenCalledWith(TX, "product_1");
    expect(state.rolledBack).toBe(true);
  });
});

describe("updateCartItem", () => {
  beforeEach(() => {
    repo.findLineInCart.mockResolvedValue({ id: "line_1", productId: "product_1", quantity: 2 });
  });

  it("sets the quantity of the actor's own line, looked up within the actor's cart", async () => {
    const line = await updateCartItem(CUSTOMER, "line_1", { quantity: 5 });
    expect(repo.inCartTransaction).toHaveBeenCalledWith(
      "user_me",
      { createCart: false },
      expect.any(Function),
    );
    expect(repo.findLineInCart).toHaveBeenCalledWith(TX, CART_ID, "line_1");
    expect(repo.setLineQuantity).toHaveBeenCalledWith(TX, CART_ID, "line_1", 5);
    expect(line).toMatchObject({ quantity: 5, requestedQuantity: 5, quantityLowered: false });
  });

  it("lowers to the stock and says so (BR-31 (2))", async () => {
    repo.findVisibleProduct.mockResolvedValue({ ...PRODUCT, stock: 4 });
    const line = await updateCartItem(CUSTOMER, "line_1", { quantity: 9 });
    expect(repo.setLineQuantity).toHaveBeenCalledWith(TX, CART_ID, "line_1", 4);
    expect(line).toMatchObject({ quantity: 4, requestedQuantity: 9, quantityLowered: true });
  });

  it("answers 404 when the actor has no cart, or the line is not in it (foreign and unknown alike)", async () => {
    cartExists(false);
    expect((await refusal(updateCartItem(CUSTOMER, "line_1", { quantity: 1 }))).toPublic()).toEqual(
      {
        code: "NOT_FOUND",
        message: "The resource was not found.",
        details: {},
      },
    );
    cartExists(true);
    repo.findLineInCart.mockResolvedValue(null);
    expect((await refusal(updateCartItem(CUSTOMER, "line_x", { quantity: 1 }))).code).toBe(
      "NOT_FOUND",
    );
    expect(repo.findVisibleProduct).not.toHaveBeenCalled();
    expect(repo.setLineQuantity).not.toHaveBeenCalled();
  });

  it("refuses a change on a hidden line with 409 NOT_AVAILABLE, never as sold out (BR-38)", async () => {
    repo.findVisibleProduct.mockResolvedValue(null);
    const error = await refusal(updateCartItem(CUSTOMER, "line_1", { quantity: 3 }));
    expect(error.toPublic()).toMatchObject({
      code: "PRODUCT_UNAVAILABLE",
      details: {
        items: [
          {
            cartItemId: "line_1",
            productId: "product_1",
            reason: "NOT_AVAILABLE",
            requestedQuantity: 3,
            availableStock: null,
          },
        ],
      },
    });
    expect(repo.setLineQuantity).not.toHaveBeenCalled();
  });

  it("refuses a change on a sold-out line with 409 INSUFFICIENT_STOCK (BR-38)", async () => {
    repo.findVisibleProduct.mockResolvedValue({ ...PRODUCT, stock: 0 });
    const error = await refusal(updateCartItem(CUSTOMER, "line_1", { quantity: 1 }));
    expect(error.code).toBe("INSUFFICIENT_STOCK");
    expect(error.details).toMatchObject({ items: [{ cartItemId: "line_1", availableStock: 0 }] });
    expect(repo.setLineQuantity).not.toHaveBeenCalled();
  });

  it("refuses a change on a line of the actor's own store (BR-16)", async () => {
    repo.findVisibleProduct.mockResolvedValue({ ...PRODUCT, storeId: "store_own" });
    const error = await refusal(updateCartItem(SELLER, "line_1", { quantity: 1 }));
    expect(error.details).toMatchObject({ items: [{ reason: "OWN_STORE", cartItemId: "line_1" }] });
    expect(repo.setLineQuantity).not.toHaveBeenCalled();
  });

  it("answers 404 when a product delete removed the line after it was read (CR-T031-02)", async () => {
    repo.setLineQuantity.mockResolvedValue(null);
    const error = await refusal(updateCartItem(CUSTOMER, "line_1", { quantity: 3 }));
    expect(error.toPublic()).toEqual({
      code: "NOT_FOUND",
      message: "The resource was not found.",
      details: {},
    });
  });
});

describe("deleteCartItem", () => {
  it("deletes the actor's own line within the actor's cart", async () => {
    repo.deleteLineInCart.mockResolvedValue(true);
    expect(await deleteCartItem(CUSTOMER, "line_1")).toEqual({ deleted: true });
    expect(repo.deleteLineInCart).toHaveBeenCalledWith(TX, CART_ID, "line_1");
    expect(repo.findVisibleProduct).not.toHaveBeenCalled();
  });

  it("answers 404 for a foreign or unknown line, and when the actor has no cart", async () => {
    repo.deleteLineInCart.mockResolvedValue(false);
    expect((await refusal(deleteCartItem(CUSTOMER, "line_x"))).code).toBe("NOT_FOUND");
    cartExists(false);
    expect((await refusal(deleteCartItem(CUSTOMER, "line_1"))).code).toBe("NOT_FOUND");
  });
});
