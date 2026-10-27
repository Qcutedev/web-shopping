/**
 * CR-S116-02: `countCartLines(actor)`, the header badge's count, against the worker's real test
 * database. It must count exactly the lines `GET /api/v1/cart` returns (docs/API_CONTRACTS.md
 * section 5.4), every line state included, and only the actor's own. No endpoint: the service is
 * called with an actor, as the header Server Component calls it. Written by backend-api for its
 * own change. Each case makes its own users and products, because the database is emptied once
 * per file, not per case.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { countCartLines } from "@/modules/cart";
import type { Actor } from "@/server/auth/actor";

import {
  createCart,
  createCartItem,
  createCategory,
  createProduct,
  createStore,
} from "../../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../../helpers/snapshot";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import { getCart, type SignedIn, signedIn } from "./support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

function customer(userId: string): Actor {
  return { userId, role: "CUSTOMER", storeId: null, storeStatus: null };
}

/** The number of lines `GET /cart` answers for this user: the badge's count before CR-S116-02. */
async function linesOfGetCart(user: SignedIn): Promise<number> {
  const answer = await getCart(user);
  expect(answer.status).toBe(200);
  return answer.body.data.stores.reduce((sum, group) => sum + group.items.length, 0);
}

describe("countCartLines (CR-S116-02)", () => {
  it("is 0 for a user without a cart, and creates no cart", async () => {
    const user = await signedIn();
    const before = await snapshotDatabase({ excludeTables: ["Session"] });
    await expect(countCartLines(customer(user.userId))).resolves.toBe(0);
    const after = await snapshotDatabase({ excludeTables: ["Session"] });
    expect(diffSnapshots(before, after)).toEqual([]);
    expect(await linesOfGetCart(user)).toBe(0);
  });

  it("is 0 for an empty cart", async () => {
    const user = await signedIn();
    await createCart({ userId: user.userId });
    await expect(countCartLines(customer(user.userId))).resolves.toBe(0);
  });

  it("counts lines, not quantities, and every line state, equal to GET /cart", async () => {
    const user = await signedIn();
    const category = await createCategory();
    const store = await createStore();
    const suspended = await createStore({ status: "SUSPENDED" });
    const cart = await createCart({ userId: user.userId });
    // Buyable (quantity 7), sold out, lowered (5 over a stock of 2), hidden, suspended store.
    const lines: { product: { id: string }; quantity: number }[] = [
      {
        product: await createProduct({ storeId: store.id, categoryId: category.id, stock: 10 }),
        quantity: 7,
      },
      {
        product: await createProduct({ storeId: store.id, categoryId: category.id, stock: 0 }),
        quantity: 3,
      },
      {
        product: await createProduct({ storeId: store.id, categoryId: category.id, stock: 2 }),
        quantity: 5,
      },
      {
        product: await createProduct({
          storeId: store.id,
          categoryId: category.id,
          status: "DRAFT",
        }),
        quantity: 1,
      },
      {
        product: await createProduct({ storeId: suspended.id, categoryId: category.id }),
        quantity: 2,
      },
    ];
    for (const { product, quantity } of lines) {
      await createCartItem({ cartId: cart.id, productId: product.id, quantity });
    }

    await expect(countCartLines(customer(user.userId))).resolves.toBe(5);
    expect(await linesOfGetCart(user)).toBe(5);
  });

  it("counts a seller's line for its own store's product, as GET /cart lists it", async () => {
    const seller = await signedIn("SELLER");
    const own = await createStore({ ownerId: seller.userId });
    const product = await createProduct({ storeId: own.id });
    const cart = await createCart({ userId: seller.userId });
    await createCartItem({ cartId: cart.id, productId: product.id, quantity: 1 });

    const actor: Actor = {
      userId: seller.userId,
      role: "SELLER",
      storeId: own.id,
      storeStatus: "APPROVED",
    };
    await expect(countCartLines(actor)).resolves.toBe(1);
    expect(await linesOfGetCart(seller)).toBe(1);
  });

  it("counts only the actor's own cart: another user's lines never show", async () => {
    const me = await signedIn();
    const other = await signedIn();
    const category = await createCategory();
    const mine = await createCart({ userId: me.userId });
    const theirs = await createCart({ userId: other.userId });
    for (let i = 0; i < 3; i += 1) {
      const product = await createProduct({ categoryId: category.id });
      await createCartItem({ cartId: theirs.id, productId: product.id, quantity: 1 });
      if (i === 0) await createCartItem({ cartId: mine.id, productId: product.id, quantity: 4 });
    }

    await expect(countCartLines(customer(me.userId))).resolves.toBe(1);
    await expect(countCartLines(customer(other.userId))).resolves.toBe(3);
    expect(await linesOfGetCart(me)).toBe(1);
  });

  it("an actor for an unknown user counts 0", async () => {
    await expect(countCartLines(customer("user_does_not_exist"))).resolves.toBe(0);
  });
});
