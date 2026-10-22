/**
 * Owner decisions of 2026-10-22, against the worker's real test database (docs/API_CONTRACTS.md
 * sections 5.5.1 and 5.5.5). Written by backend-api for its own change.
 *
 * - SEC-053: `POST /api/v1/checkout` refuses a cart of more than MAX_CART_LINES (50) lines with
 *   `409 CONFLICT` `CART_LINE_LIMIT` before any stock statement; a cart of exactly 50 is bought.
 * - SEC-056: with `NODE_ENV=production` the mock provider is refused, so checkout is a `500` with
 *   nothing locked, taken, or written.
 *
 * Each case makes its own users and products, because the database is emptied once per file.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CART_LINE_LIMIT_REASON, MAX_CART_LINES } from "@/modules/cart";
import { checkout } from "@/modules/checkout";
import { MockPaymentProviderInProductionError } from "@/modules/payments";
import { db } from "@/server/db";

import {
  createCartItem,
  createCategory,
  createProduct,
  createStore,
} from "../../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../../helpers/snapshot";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import { newKey, postCheckout, readyToBuy, type SignedIn, signedIn } from "./support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** `count` visible products of one store, each with stock 5. */
async function products(count: number): Promise<string[]> {
  const store = await createStore();
  const category = await createCategory();
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const product = await createProduct({ storeId: store.id, categoryId: category.id, stock: 5 });
    ids.push(product.id);
  }
  return ids;
}

/** A user with an address and a cart of one line per product (quantity 1), straight in the database. */
async function cartOf(
  count: number,
): Promise<{ user: SignedIn; addressId: string; ids: string[] }> {
  const user = await signedIn();
  const ids = await products(count);
  const { addressId, cartId } = await readyToBuy(user, []);
  for (const productId of ids) {
    await createCartItem({ cartId, productId, quantity: 1 });
  }
  return { user, addressId, ids };
}

async function stockTaken(ids: readonly string[]): Promise<number> {
  return db.product.count({ where: { id: { in: [...ids] }, stock: { lt: 5 } } });
}

describe("POST /checkout: at most 50 cart lines (SEC-053)", () => {
  it("a cart of exactly 50 lines is bought", async () => {
    const { user, addressId, ids } = await cartOf(MAX_CART_LINES);
    const answer = await postCheckout(user, { addressId, paymentMethod: "MOCK" });
    expect(answer.status).toBe(201);
    expect(answer.body.data.paymentStatus).toBe("PAID");
    expect(answer.body.data.sellerOrders[0]?.items).toHaveLength(MAX_CART_LINES);
    expect(await stockTaken(ids)).toBe(MAX_CART_LINES);
  }, 60_000);

  it("a cart of 51 lines is 409 CONFLICT CART_LINE_LIMIT: no order, no stock taken, cart unchanged", async () => {
    const { user, addressId, ids } = await cartOf(MAX_CART_LINES + 1);
    const before = await snapshotDatabase({ excludeTables: ["Session"] });

    const answer = await postCheckout(user, { addressId, paymentMethod: "MOCK" });
    expect(answer.status).toBe(409);
    expect(answer.body.error.code).toBe("CONFLICT");
    expect(answer.body.error.details).toEqual({ reason: CART_LINE_LIMIT_REASON });

    const after = await snapshotDatabase({ excludeTables: ["Session"] });
    expect(diffSnapshots(before, after)).toEqual([]);
    expect(await stockTaken(ids)).toBe(0);
    expect(await db.order.count({ where: { userId: user.userId } })).toBe(0);
  }, 60_000);

  it("a cart of 120 lines is refused the same way and takes no stock", async () => {
    const { user, addressId, ids } = await cartOf(120);
    const answer = await postCheckout(user, { addressId, paymentMethod: "MOCK" });
    expect(answer.status).toBe(409);
    expect(answer.body.error.details).toEqual({ reason: CART_LINE_LIMIT_REASON });
    expect(await stockTaken(ids)).toBe(0);
  }, 60_000);

  it("after removing one line, the same cart is bought", async () => {
    const { user, addressId, ids } = await cartOf(MAX_CART_LINES + 1);
    expect((await postCheckout(user, { addressId, paymentMethod: "MOCK" })).status).toBe(409);
    await db.cartItem.deleteMany({ where: { productId: ids[MAX_CART_LINES] } });
    const answer = await postCheckout(user, { addressId, paymentMethod: "MOCK" });
    expect(answer.status).toBe(201);
    expect(await stockTaken(ids)).toBe(MAX_CART_LINES);
  }, 60_000);

  it("the refusals before it still come first: 401, 400, and another user's address 404", async () => {
    const { user, addressId } = await cartOf(MAX_CART_LINES + 1);
    const stranger = await signedIn();
    expect((await postCheckout(null, { addressId, paymentMethod: "MOCK" })).status).toBe(401);
    const invalid = await postCheckout(user, { addressId, paymentMethod: "MOCK", totalSatang: 1 });
    expect(invalid.status).toBe(400);
    const foreign = await postCheckout(stranger, { addressId, paymentMethod: "MOCK" });
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.details).toEqual({ resource: "address" });
  }, 60_000);
});

describe("POST /checkout with NODE_ENV=production: the mock provider is refused (SEC-056)", () => {
  it("the route answers 500 INTERNAL_ERROR, logs the class only, and nothing is locked, taken, or written", async () => {
    const { user, addressId, ids } = await cartOf(2);
    // A first request in test mode, so the process configuration is read and cached as in any
    // running server before the stub; the 500 below is then the provider's refusal only.
    expect(
      (await postCheckout(user, { addressId, paymentMethod: "MOCK" }, { key: null })).status,
    ).toBe(400);
    const before = await snapshotDatabase({ excludeTables: ["Session"] });
    const written: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });

    vi.stubEnv("NODE_ENV", "production");
    const answer = await postCheckout(user, { addressId, paymentMethod: "MOCK" });
    vi.unstubAllEnvs();

    expect(answer.status).toBe(500);
    expect(answer.body.error.code).toBe("INTERNAL_ERROR");
    expect(answer.body.error.details).toEqual({});
    expect(JSON.stringify(answer.body)).not.toMatch(/mock|SEC-056|production/i);
    const logged = written.join("");
    expect(logged).toContain("MockPaymentProviderInProductionError");
    expect(logged).not.toContain("The mock payment provider is refused");

    const after = await snapshotDatabase({ excludeTables: ["Session"] });
    expect(diffSnapshots(before, after)).toEqual([]);
    expect(await stockTaken(ids)).toBe(0);
  }, 60_000);

  it("the service throws before its transaction; the same cart is bought once NODE_ENV is not production", async () => {
    const { user, addressId, ids } = await cartOf(2);
    const actor = {
      userId: user.userId,
      role: "CUSTOMER",
      storeId: null,
      storeStatus: null,
    } as const;
    const body = { addressId, paymentMethod: "MOCK", mockOutcome: "SUCCESS" } as const;
    const before = await snapshotDatabase({ excludeTables: ["Session"] });

    vi.stubEnv("NODE_ENV", "production");
    await expect(checkout(actor, newKey(), body)).rejects.toBeInstanceOf(
      MockPaymentProviderInProductionError,
    );
    vi.unstubAllEnvs();
    expect(diffSnapshots(before, await snapshotDatabase({ excludeTables: ["Session"] }))).toEqual(
      [],
    );

    const bought = await checkout(actor, newKey(), body);
    expect(bought.created).toBe(true);
    expect(bought.order.paymentStatus).toBe("PAID");
    expect(bought.order.payment.isSimulated).toBe(true);
    expect(await stockTaken(ids)).toBe(2);
  }, 60_000);
});
