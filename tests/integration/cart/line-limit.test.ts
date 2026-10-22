/**
 * SEC-053 (owner decision 2026-10-22): a cart holds at most MAX_CART_LINES (50) distinct lines.
 * `POST /api/v1/cart/items` against the worker's real test database (docs/API_CONTRACTS.md section
 * 5.4). Written by backend-api for its own change. Each case makes its own users and products,
 * because the database is emptied once per file, not per case.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { CART_LINE_LIMIT_REASON, MAX_CART_LINES } from "@/modules/cart";
import { db } from "@/server/db";

import {
  createCart,
  createCartItem,
  createCategory,
  createProduct,
  createStore,
} from "../../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../../helpers/snapshot";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import { addItem, deleteItem, patchItem, type SignedIn, signedIn, storedLines } from "./support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

/** `count` visible products of one store, each with stock 10. */
async function products(count: number): Promise<string[]> {
  const store = await createStore();
  const category = await createCategory();
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const product = await createProduct({ storeId: store.id, categoryId: category.id, stock: 10 });
    ids.push(product.id);
  }
  return ids;
}

/** Fills the user's cart with one line per product, straight in the database. */
async function fill(user: SignedIn, productIds: readonly string[]): Promise<void> {
  const cart = await createCart({ userId: user.userId });
  for (const productId of productIds) {
    await createCartItem({ cartId: cart.id, productId, quantity: 1 });
  }
}

describe("POST /cart/items: at most 50 distinct lines (SEC-053)", () => {
  it("the limit is 50", () => {
    expect(MAX_CART_LINES).toBe(50);
  });

  it("the 50th distinct line is created through the route, the 51st is 409 CONFLICT and stores nothing", async () => {
    const user = await signedIn();
    const ids = await products(MAX_CART_LINES + 1);
    for (const productId of ids.slice(0, MAX_CART_LINES)) {
      expect((await addItem(user, { productId, quantity: 1 })).status).toBe(201);
    }
    expect(await storedLines(user.userId)).toHaveLength(MAX_CART_LINES);

    const before = await snapshotDatabase({ excludeTables: ["Session"] });
    const refused = await addItem(user, { productId: ids[MAX_CART_LINES], quantity: 1 });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("CONFLICT");
    expect(refused.body.error.details).toEqual({ reason: CART_LINE_LIMIT_REASON });
    const after = await snapshotDatabase({ excludeTables: ["Session"] });
    expect(diffSnapshots(before, after)).toEqual([]);
  }, 60_000);

  it("a full cart still accepts a quantity change: an add to an existing line and a PATCH", async () => {
    const user = await signedIn();
    const ids = await products(MAX_CART_LINES);
    await fill(user, ids);
    const [first] = await storedLines(user.userId);
    if (first === undefined) throw new Error("fixture");

    const added = await addItem(user, { productId: first.productId, quantity: 2 });
    expect(added.status).toBe(200);
    expect(added.body.data.quantity).toBe(3);

    const patched = await patchItem(user, first.id, { quantity: 5 });
    expect(patched.status).toBe(200);
    expect(patched.body.data.quantity).toBe(5);
    expect(await storedLines(user.userId)).toHaveLength(MAX_CART_LINES);
  }, 60_000);

  it("after a line is removed from a full cart, a new line can be added again", async () => {
    const user = await signedIn();
    const ids = await products(MAX_CART_LINES + 1);
    await fill(user, ids.slice(0, MAX_CART_LINES));
    const [first] = await storedLines(user.userId);
    if (first === undefined) throw new Error("fixture");

    expect((await deleteItem(user, first.id)).status).toBe(200);
    const added = await addItem(user, { productId: ids[MAX_CART_LINES], quantity: 1 });
    expect(added.status).toBe(201);
    expect(await storedLines(user.userId)).toHaveLength(MAX_CART_LINES);
  }, 60_000);

  it("a cart above the limit (items returned by a failed payment) refuses every new line", async () => {
    const user = await signedIn();
    const ids = await products(MAX_CART_LINES + 2);
    await fill(user, ids.slice(0, MAX_CART_LINES + 1));
    const refused = await addItem(user, { productId: ids[MAX_CART_LINES + 1], quantity: 1 });
    expect(refused.status).toBe(409);
    expect(refused.body.error.details).toEqual({ reason: CART_LINE_LIMIT_REASON });
    expect(await storedLines(user.userId)).toHaveLength(MAX_CART_LINES + 1);
  }, 60_000);

  it("the limit is per cart: another user's full cart does not limit mine", async () => {
    const full = await signedIn();
    const other = await signedIn();
    const ids = await products(MAX_CART_LINES + 1);
    await fill(full, ids.slice(0, MAX_CART_LINES));

    const mine = await addItem(other, { productId: ids[MAX_CART_LINES], quantity: 1 });
    expect(mine.status).toBe(201);
    expect(await storedLines(full.userId)).toHaveLength(MAX_CART_LINES);
  }, 60_000);

  it("concurrent adds of new lines into a cart one line from the limit: exactly one is created", async () => {
    const user = await signedIn();
    const ids = await products(MAX_CART_LINES - 1 + 5);
    await fill(user, ids.slice(0, MAX_CART_LINES - 1));

    const answers = await Promise.all(
      ids.slice(MAX_CART_LINES - 1).map((productId) => addItem(user, { productId, quantity: 1 })),
    );
    const statuses = answers.map((answer) => answer.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    for (const answer of answers.filter((a) => a.status === 409)) {
      expect(answer.body.error.details).toEqual({ reason: CART_LINE_LIMIT_REASON });
    }
    expect(await storedLines(user.userId)).toHaveLength(MAX_CART_LINES);
  }, 60_000);

  it("validation and authentication come first: 400 and 401 on a full cart store nothing", async () => {
    const user = await signedIn();
    const ids = await products(MAX_CART_LINES + 1);
    await fill(user, ids.slice(0, MAX_CART_LINES));
    const before = await snapshotDatabase({ excludeTables: ["Session"] });

    const invalid = await addItem(user, { productId: ids[MAX_CART_LINES], quantity: 0 });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
    expect((await addItem(null, { productId: ids[MAX_CART_LINES], quantity: 1 })).status).toBe(401);

    const after = await snapshotDatabase({ excludeTables: ["Session"] });
    expect(diffSnapshots(before, after)).toEqual([]);
    expect(await db.cartItem.count({ where: { productId: ids[MAX_CART_LINES] } })).toBe(0);
  }, 60_000);
});
