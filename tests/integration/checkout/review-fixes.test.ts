/**
 * T-032 review fixes against the real test database (docs/reviews/T-032-code-review.md,
 * docs/reviews/T-032-security.md):
 *
 *   - CR-T032-05: a checkout whose first attempt is undone succeeds on its second attempt, with a
 *     fresh savepoint, and only the second attempt's stock is taken;
 *   - CR-T032-02: a decline waits behind a cart lock held longer than Prisma's default 5 s and
 *     still fails the order;
 *   - SEC-055 item 2, CR-T032-03: a payment outcome that cannot be recorded after the order
 *     committed is answered 201 with the order `PENDING`, never 500.
 *
 * Fault-injection seams, used only by the cases that say so: `takeStock` and
 * `completeOrderPayment` run the real code unless a case queues a one-time replacement.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { checkout } from "@/modules/checkout";
import { takeStock } from "@/modules/checkout/repository";
import { completeOrderPayment, failOrderPayment } from "@/modules/orders";
import type { PaymentProvider } from "@/modules/payments";
import { db } from "@/server/db";

import { createProduct } from "../../helpers/factories";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import { getOrder, postCheckout, readyToBuy, signedIn } from "./support";

vi.mock("@/modules/checkout/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/checkout/repository")>();
  return { ...actual, takeStock: vi.fn(actual.takeStock) };
});

vi.mock("@/modules/orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/orders")>();
  return { ...actual, completeOrderPayment: vi.fn(actual.completeOrderPayment) };
});

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

afterEach(() => {
  vi.mocked(takeStock).mockReset();
  vi.mocked(completeOrderPayment).mockReset();
});

async function stockOf(productId: string): Promise<number> {
  const row = await db.product.findUniqueOrThrow({
    where: { id: productId },
    select: { stock: true },
  });
  return row.stock;
}

describe("CR-T032-05: a checkout that succeeds on its second attempt", () => {
  it("the first attempt is undone, a fresh savepoint is set, and only the second attempt's stock is taken", async () => {
    const user = await signedIn();
    const first = await createProduct({ stock: 5, priceSatang: 10_000 });
    const second = await createProduct({ stock: 5, priceSatang: 20_000 });
    const [kept, deleted] = first.id < second.id ? [first, second] : [second, first];
    const { addressId } = await readyToBuy(user, [
      { productId: kept.id, quantity: 2 },
      { productId: deleted.id, quantity: 1 },
    ]);

    // Attempt 1 takes `kept` (product id order), then, before `deleted` is taken, the product is
    // hard deleted by another connection: its stock statement affects no row, the attempt is
    // rolled back, and the refusal read finds the remaining line buyable, so attempt 2 runs.
    const actual = (
      await vi.importActual<typeof import("@/modules/checkout/repository")>(
        "@/modules/checkout/repository",
      )
    ).takeStock;
    let calls = 0;
    vi.mocked(takeStock).mockImplementation(async (tx, buyerId, productId, quantity) => {
      calls += 1;
      if (calls === 2) {
        expect(productId).toBe(deleted.id);
        await db.product.delete({ where: { id: deleted.id } });
      }
      return actual(tx, buyerId, productId, quantity);
    });

    const response = await postCheckout(user, { addressId, paymentMethod: "MOCK" });
    expect(response.status).toBe(201);
    // Attempt 1: kept, deleted. Attempt 2: kept only (the line went with the product).
    expect(calls).toBe(3);
    const order = response.body.data;
    expect(order.paymentStatus).toBe("PAID");
    expect(order.sellerOrders.flatMap((part) => part.items.map((item) => item.productId))).toEqual([
      kept.id,
    ]);
    expect(order.itemsSubtotalSatang).toBe(2 * kept.priceSatang);
    expect(order.grandTotalSatang).toBe(2 * kept.priceSatang + order.shippingTotalSatang);
    // Taken once, by attempt 2: attempt 1's decrement was rolled back.
    expect(await stockOf(kept.id)).toBe(3);
    expect(await db.cartItem.count({ where: { cart: { userId: user.userId } } })).toBe(0);
  });
});

describe("CR-T032-02: a decline behind a long-held cart lock", () => {
  it("waits for the lock beyond Prisma's 5 s default and fails the order", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 10 });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 4 }]);
    const silent: PaymentProvider = {
      name: "MOCK",
      isSimulated: true,
      charge: () => Promise.reject(new Error("no answer")),
    };
    const placed = await checkout(
      { userId: user.userId, role: "CUSTOMER", storeId: null, storeStatus: null },
      crypto.randomUUID(),
      { addressId, paymentMethod: "MOCK", mockOutcome: "FAIL" },
      { provider: silent },
    );
    expect(placed.order.paymentStatus).toBe("PENDING");
    expect(await stockOf(product.id)).toBe(6);

    // Another transaction holds the customer's cart lock for 6 s, as a checkout may.
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holder = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Cart" WHERE "userId" = ${user.userId} FOR UPDATE`;
        locked();
        await tx.$executeRaw`SELECT pg_sleep(6)`;
      },
      { maxWait: 5_000, timeout: 15_000 },
    );
    await lockTaken;
    const started = Date.now();
    await expect(failOrderPayment(placed.order.id, "SIMULATED_DECLINE")).resolves.toBe(true);
    expect(Date.now() - started).toBeGreaterThan(5_000);
    await holder;

    const failed = (await getOrder(user, placed.order.id)).body.data;
    expect(failed.paymentStatus).toBe("FAILED");
    expect(failed.payment.failureReason).toBe("SIMULATED_DECLINE");
    expect(await stockOf(product.id)).toBe(10);
  }, 30_000);
});

describe("SEC-055 item 2, CR-T032-03: the payment outcome cannot be recorded after the order committed", () => {
  it("answers 201 with the order PENDING, its stock taken, and a repeat with the key returns it", async () => {
    const user = await signedIn();
    const product = await createProduct({ stock: 10 });
    const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 3 }]);
    vi.mocked(completeOrderPayment).mockRejectedValueOnce(
      Object.assign(new Error("Transaction already closed"), { code: "P2028" }),
    );

    const key = crypto.randomUUID();
    const response = await postCheckout(user, { addressId, paymentMethod: "MOCK" }, { key });
    expect(response.status).toBe(201);
    expect(response.body.data.paymentStatus).toBe("PENDING");
    expect(response.body.data.paidAt).toBeNull();
    expect(await stockOf(product.id)).toBe(7);

    const repeat = await postCheckout(user, { addressId, paymentMethod: "MOCK" }, { key });
    expect(repeat.status).toBe(200);
    expect(repeat.body.data.id).toBe(response.body.data.id);
    expect(repeat.body.data.paymentStatus).toBe("PENDING");
    expect(await db.order.count({ where: { userId: user.userId } })).toBe(1);
  });
});
