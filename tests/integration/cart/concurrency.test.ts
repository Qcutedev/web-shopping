/**
 * T-031 races of the cart writes on a real PostgreSQL (CR-T031-01, CR-T031-02;
 * docs/API_CONTRACTS.md section 5.4; DATA_MODEL.md sections 7.5 and 21.5).
 *
 * The cart write takes the user's `Cart` row `FOR UPDATE`, so the writes of one user run one
 * after the other. The tests send the requests together and check what is stored, not an order.
 * The two product-delete cases hold an uncommitted delete so that the write is known to be
 * waiting on its row lock before the delete commits (the pattern of the profile address test).
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, type DbTransaction } from "@/server/db";

import { createCartItem, createProduct, createStore } from "../../helpers/factories";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import { addItem, deleteItem, getCart, patchItem, signedIn, storedLines } from "./support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

function sorted(statuses: number[]): number[] {
  return [...statuses].sort((a, b) => a - b);
}

/** Polls until some other backend waits on a lock, so the write is known to be blocked. */
async function untilSomeoneWaitsOnALock(tx: DbTransaction): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    // pg_stat_activity is a snapshot taken once per transaction; clear it for each poll.
    await tx.$queryRaw`SELECT 1 AS cleared FROM pg_stat_clear_snapshot()`;
    const [waiting] = await tx.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'`;
    if ((waiting?.n ?? 0) > 0) return;
    if (Date.now() > deadline) throw new Error("the write never waited on the deleted row");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("concurrent writes of one user", () => {
  it("N first adds of one product give one cart, one line, and the summed quantity", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 50 });
    const count = 8;
    const responses = await Promise.all(
      Array.from({ length: count }, () => addItem(user, { productId: product.id, quantity: 2 })),
    );
    expect(sorted(responses.map((response) => response.status))).toEqual([
      ...Array<number>(count - 1).fill(200),
      201,
    ]);
    expect(await db.cart.count({ where: { userId: user.userId } })).toBe(1);
    const lines = await storedLines(user.userId);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantity).toBe(count * 2);
    expect(new Set(responses.map((response) => response.body.data.id)).size).toBe(1);
  });

  it("concurrent first adds of different products give one cart and one line each", async () => {
    const user = await signedIn();
    const products = await Promise.all([createProduct(), createProduct(), createProduct()]);
    const responses = await Promise.all(
      products.map((product) => addItem(user, { productId: product.id, quantity: 1 })),
    );
    expect(responses.map((response) => response.status)).toEqual([201, 201, 201]);
    expect(await db.cart.count({ where: { userId: user.userId } })).toBe(1);
    expect(await storedLines(user.userId)).toHaveLength(3);
  });

  it("two adds to one existing line sum: 3 + 4 on a line of 1 is 8", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 50 });
    await addItem(user, { productId: product.id, quantity: 1 });
    const responses = await Promise.all([
      addItem(user, { productId: product.id, quantity: 3 }),
      addItem(user, { productId: product.id, quantity: 4 }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const lines = await storedLines(user.userId);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantity).toBe(8);
  });

  it("50 + 50 in parallel on a new line give one 400 and a line at or below 99", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 500 });
    const responses = await Promise.all([
      addItem(user, { productId: product.id, quantity: 50 }),
      addItem(user, { productId: product.id, quantity: 50 }),
    ]);
    expect(sorted(responses.map((response) => response.status))).toEqual([201, 400]);
    const lines = await storedLines(user.userId);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantity).toBe(50);
  });

  it("many adds that together pass 99 never store a quantity above 99", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 500 });
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => addItem(user, { productId: product.id, quantity: 30 })),
    );
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 400)).toHaveLength(3);
    expect(statuses.filter((status) => status === 201 || status === 200)).toHaveLength(3);
    const lines = await storedLines(user.userId);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantity).toBe(90);
  });

  it("a PATCH and a DELETE of one line leave the line gone or set, never an error", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 50 });
    const created = await addItem(user, { productId: product.id, quantity: 1 });
    const [patched, deleted] = await Promise.all([
      patchItem(user, created.body.data.id, { quantity: 5 }),
      deleteItem(user, created.body.data.id),
    ]);
    expect([200, 404]).toContain(patched.status);
    expect(deleted.status).toBe(200);
    // Whatever the order, the delete ran, so the line is gone.
    expect(await storedLines(user.userId)).toEqual([]);
  });

  it("reads running together with adds never fail", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 50 });
    const results = await Promise.all([
      addItem(user, { productId: product.id, quantity: 1 }),
      getCart(user),
      addItem(user, { productId: product.id, quantity: 1 }),
      getCart(user),
    ]);
    expect(results.map((result) => result.status).every((status) => status < 300)).toBe(true);
    expect((await storedLines(user.userId))[0]?.quantity).toBe(2);
  });

  it("two users adding the same product do not touch each other's line", async () => {
    const a = await signedIn();
    const b = await signedIn();
    const product = await createProduct({ stock: 50 });
    const responses = await Promise.all([
      addItem(a, { productId: product.id, quantity: 2 }),
      addItem(b, { productId: product.id, quantity: 5 }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect((await storedLines(a.userId))[0]?.quantity).toBe(2);
    expect((await storedLines(b.userId))[0]?.quantity).toBe(5);
  });
});

describe("a product hard-deleted while a cart write runs (CR-T031-02)", () => {
  it("POST: the insert hits the product foreign key (P2003) and the answer is 404, not 500", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 5 });
    let add: ReturnType<typeof addItem> | undefined;

    // The delete is uncommitted: the add reads the product as visible, then its insert waits on
    // the product row for the foreign-key check, and fails once the delete commits.
    await db.$transaction(
      async (tx) => {
        await tx.product.delete({ where: { id: product.id } });
        add = addItem(user, { productId: product.id, quantity: 1 });
        await untilSomeoneWaitsOnALock(tx);
      },
      { timeout: 10_000 },
    );

    if (add === undefined) throw new Error("the add was not started");
    const response = await add;
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(response.body.error.details).toEqual({ resource: "product" });
    expect(await storedLines(user.userId)).toEqual([]);
    // The failed write rolled back with its transaction, so the cart row it created is gone too.
    expect(await db.cart.count({ where: { userId: user.userId } })).toBe(0);
  });

  it("PATCH: the line is removed by the cascade and the answer is the line's 404, not 500", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 5 });
    const created = await addItem(user, { productId: product.id, quantity: 1 });
    expect(created.status).toBe(201);
    let patch: ReturnType<typeof patchItem> | undefined;

    await db.$transaction(
      async (tx) => {
        await tx.product.delete({ where: { id: product.id } });
        patch = patchItem(user, created.body.data.id, { quantity: 3 });
        await untilSomeoneWaitsOnALock(tx);
      },
      { timeout: 10_000 },
    );

    if (patch === undefined) throw new Error("the patch was not started");
    const response = await patch;
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(response.body.error.details).toEqual({});
    expect(await storedLines(user.userId)).toEqual([]);
  });

  it("a delete of the line that is already gone after a cascade is 404", async () => {
    const user = await signedIn();
    const product = await createProduct();
    const created = await addItem(user, { productId: product.id, quantity: 1 });
    await db.product.delete({ where: { id: product.id } });
    expect((await deleteItem(user, created.body.data.id)).status).toBe(404);
    expect((await getCart(user)).body.data.stores).toEqual([]);
  });
});

describe("the transaction rolls back whole", () => {
  it("a refused first add leaves no cart row behind", async () => {
    const user = await signedIn();
    const soldOut = await createProduct({ stock: 0 });
    const response = await addItem(user, { productId: soldOut.id, quantity: 1 });
    expect(response.status).toBe(409);
    expect(await db.cart.count({ where: { userId: user.userId } })).toBe(0);
  });

  it("a seller's refused own-store add leaves no cart row behind", async () => {
    const seller = await signedIn("SELLER");
    const store = await createStore({ ownerId: seller.userId });
    const own = await createProduct({ storeId: store.id });
    expect((await addItem(seller, { productId: own.id, quantity: 1 })).status).toBe(409);
    expect(await db.cart.count({ where: { userId: seller.userId } })).toBe(0);
  });

  it("a refused add to an existing line changes neither quantity nor other lines", async () => {
    const user = await signedIn();
    const cart = await db.cart.create({ data: { userId: user.userId } });
    const a = await createProduct({ stock: 500 });
    const b = await createProduct({ stock: 500 });
    const lineA = await createCartItem({ cartId: cart.id, productId: a.id, quantity: 98 });
    const lineB = await createCartItem({ cartId: cart.id, productId: b.id, quantity: 4 });
    expect((await addItem(user, { productId: a.id, quantity: 2 })).status).toBe(400);
    expect(await storedLines(user.userId)).toEqual(
      [
        { id: lineA.id, productId: a.id, quantity: 98 },
        { id: lineB.id, productId: b.id, quantity: 4 },
      ].sort((x, y) => x.id.localeCompare(y.id)),
    );
  });
});
