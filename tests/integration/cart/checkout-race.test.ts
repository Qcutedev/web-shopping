/**
 * T-033: cart edits racing a checkout of the same user (REQ-N-05; DATA_MODEL.md section 7.5).
 * Checkout and the cart writes both take the user's `Cart` row `FOR UPDATE`, so each outcome is one
 * of the two serial orders. The tests send both together, accept either order, and check the
 * conservation rule: units ordered + units left in the cart = units the customer asked for, and
 * the stock fell by exactly the units ordered.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";

import { createProduct } from "../../helpers/factories";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import { newKey, postCheckout, readyToBuy } from "../checkout/support";
import { addItem, deleteItem, patchItem, signedIn, storedLines } from "./support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

async function orderedUnits(userId: string, productId: string): Promise<number> {
  const items = await db.orderItem.findMany({
    where: { productId, sellerOrder: { order: { userId } } },
    select: { quantity: true },
  });
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

async function stockOf(productId: string): Promise<number> {
  return (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock;
}

describe("cart edits during checkout", () => {
  it("an add of the same product: the units are in the order or left in the cart, never lost", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 50 });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 3 }]);
    const [bought, added] = await Promise.all([
      postCheckout(user, { addressId, paymentMethod: "MOCK" }),
      addItem(user, { productId: product.id, quantity: 4 }),
    ]);
    expect(bought.status).toBe(201);
    expect([200, 201]).toContain(added.status);
    const ordered = await orderedUnits(user.userId, product.id);
    const left = (await storedLines(user.userId)).reduce((sum, l) => sum + l.quantity, 0);
    // Add first: the order holds 7. Checkout first: the order holds 3 and the cart 4.
    expect([3, 7]).toContain(ordered);
    expect(ordered + left).toBe(7);
    expect(await stockOf(product.id)).toBe(50 - ordered);
  });

  it("a quantity change: the order holds the old or the new quantity, whole, and stock agrees", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 50 });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 3 }]);
    const [stored] = await storedLines(user.userId);
    const [bought, patched] = await Promise.all([
      postCheckout(user, { addressId, paymentMethod: "MOCK" }),
      patchItem(user, stored?.id ?? "", { quantity: 9 }),
    ]);
    expect(bought.status).toBe(201);
    const ordered = await orderedUnits(user.userId, product.id);
    if (patched.status === 200) {
      expect(ordered).toBe(9);
    } else {
      // The checkout emptied the cart first: the line is gone.
      expect(patched.status).toBe(404);
      expect(ordered).toBe(3);
    }
    expect(await storedLines(user.userId)).toEqual([]);
    expect(await stockOf(product.id)).toBe(50 - ordered);
  });

  it("a delete of the only line: no order and the stock untouched, or the order and a 404", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 10 });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 2 }]);
    const [stored] = await storedLines(user.userId);
    const [bought, deleted] = await Promise.all([
      postCheckout(user, { addressId, paymentMethod: "MOCK" }),
      deleteItem(user, stored?.id ?? ""),
    ]);
    const orders = await db.order.count({ where: { userId: user.userId } });
    if (bought.status === 201) {
      expect(orders).toBe(1);
      expect(await stockOf(product.id)).toBe(8);
      expect(deleted.status).toBe(404);
    } else {
      expect(bought.status).toBeGreaterThanOrEqual(400);
      expect(deleted.status).toBe(200);
      expect(orders).toBe(0);
      expect(await stockOf(product.id)).toBe(10);
    }
    expect(await storedLines(user.userId)).toEqual([]);
  });

  it("an add after the order with the same key repeated: the repeat is the first order, unchanged", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 50 });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 2 }]);
    const key = newKey();
    const first = await postCheckout(user, { addressId, paymentMethod: "MOCK" }, { key });
    expect(first.status).toBe(201);
    await addItem(user, { productId: product.id, quantity: 5 });
    const repeat = await postCheckout(user, { addressId, paymentMethod: "MOCK" }, { key });
    expect(repeat.status).toBe(200);
    expect(repeat.body.data.id).toBe(first.body.data.id);
    expect(await orderedUnits(user.userId, product.id)).toBe(2);
    expect((await storedLines(user.userId))[0]?.quantity).toBe(5);
    expect(await stockOf(product.id)).toBe(48);
  });
});
