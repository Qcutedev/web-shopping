/**
 * T-032: two basic races of checkout against the real database (D-023; DATA_MODEL.md section 7.1).
 * The full set (T-033, N-05) is qa's; these show the mechanism holds for the two cases the task
 * names: a duplicate submission with one key, and the last item bought by two customers at once.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";

import { createProduct } from "../../helpers/factories";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import { newKey, postCheckout, readyToBuy, signedIn } from "./support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

describe("checkout races", () => {
  it("two simultaneous requests with one key create one order and both answer it", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 10 });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 2 }]);
    const key = newKey();
    const body = { addressId, paymentMethod: "MOCK" };
    const [one, two] = await Promise.all([
      postCheckout(user, body, { key }),
      postCheckout(user, body, { key }),
    ]);
    expect([one.status, two.status].sort()).toEqual([200, 201]);
    expect(one.body.data.id).toBe(two.body.data.id);
    expect(await db.order.count({ where: { userId: user.userId } })).toBe(1);
    const product2 = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(product2.stock).toBe(8);
  });

  it("the last item bought by two customers at once: exactly one order, stock never negative", async () => {
    const product = await createProduct({ stock: 1 });
    const alice = await signedIn();
    const bob = await signedIn();
    const a = await readyToBuy(alice, [{ productId: product.id, quantity: 1 }]);
    const b = await readyToBuy(bob, [{ productId: product.id, quantity: 1 }]);
    const [first, second] = await Promise.all([
      postCheckout(alice, { addressId: a.addressId, paymentMethod: "MOCK" }),
      postCheckout(bob, { addressId: b.addressId, paymentMethod: "MOCK" }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const refused = first.status === 409 ? first : second;
    expect(refused.body.error.code).toBe("INSUFFICIENT_STOCK");
    const stored = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(stored.stock).toBe(0);
    expect(await db.order.count({ where: { userId: { in: [alice.userId, bob.userId] } } })).toBe(1);
  });
});
