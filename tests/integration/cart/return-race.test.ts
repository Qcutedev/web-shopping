/**
 * T-033 CC-12: items returning to the cart (payment-timeout sweep or a decline) racing
 * `POST /cart/items` for the same product (BR-32; DATA_MODEL.md sections 7.2 and 7.5). Both writers
 * take the user's `Cart` row `FOR UPDATE`, so each run ends as one of two serial orders:
 *   add first, then the return (the return merges onto the added line, capped), or
 *   return first, then the add (the add sees the returned line and may be refused at 99).
 * The tests send both together, accept either order, and check: the final line equals a serial
 * outcome, never passes 99 or the stock, no quantity is lost, and the two return columns of the
 * order item are written once and agree with each other and with the cart.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { checkout } from "@/modules/checkout";
import { failOrderPayment, failOverdueOrders } from "@/modules/orders";
import type { PaymentProvider } from "@/modules/payments";
import { db } from "@/server/db";

import { createProduct } from "../../helpers/factories";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import { newKey, readyToBuy } from "../checkout/support";
import { addItem, signedIn, storedLines, type SignedIn } from "./support";

/** Repeats of each race, so a lost race is likely to show at least once. */
const REPEATS = 8;

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

/** An order whose provider never answered: payment PENDING, stock taken, cart emptied. */
async function pendingOrder(user: SignedIn, productId: string, quantity: number) {
  const { addressId } = await readyToBuy(user, [{ productId, quantity }]);
  const silent: PaymentProvider = {
    name: "MOCK",
    isSimulated: true,
    charge: () => Promise.reject(new Error("no answer")),
  };
  const result = await checkout(
    { userId: user.userId, role: "CUSTOMER", storeId: null, storeStatus: null },
    newKey(),
    { addressId, paymentMethod: "MOCK", mockOutcome: "SUCCESS" },
    { provider: silent },
  );
  expect(result.order.paymentStatus).toBe("PENDING");
  return result.order.id;
}

async function overdue(orderId: string): Promise<void> {
  await db.$executeRaw`UPDATE "Order" SET "createdAt" = now() - interval '30 minutes' WHERE "id" = ${orderId}`;
}

async function returnColumns(orderId: string) {
  const items = await db.orderItem.findMany({
    where: { sellerOrder: { orderId } },
    select: {
      cartQuantityBeforeReturn: true,
      cartQuantityAfterReturn: true,
      stockRestoredAt: true,
    },
  });
  expect(items).toHaveLength(1);
  return items[0] as NonNullable<(typeof items)[number]>;
}

async function stockOf(productId: string): Promise<number> {
  return (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock;
}

type Returner = (orderId: string) => Promise<unknown>;

const RETURNERS: [string, Returner][] = [
  ["the timeout sweep", () => failOverdueOrders(15)],
  ["a decline", (orderId) => failOrderPayment(orderId, "SIMULATED_DECLINE")],
];

describe.each(RETURNERS)("CC-12: %s racing an add of the same product", (_name, returner) => {
  it("both fit under 99: the line is the sum, whichever ran first, and nothing is lost", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < REPEATS; i += 1) {
      const user = await signedIn();
      const product = await createProduct({ stock: 200 });
      const orderId = await pendingOrder(user, product.id, 3);
      await overdue(orderId);
      expect(await stockOf(product.id)).toBe(197);

      const [, added] = await Promise.all([
        returner(orderId),
        addItem(user, { productId: product.id, quantity: 4 }),
      ]);

      expect([200, 201]).toContain(added.status);
      const lines = await storedLines(user.userId);
      expect(lines.map((line) => [line.productId, line.quantity])).toEqual([[product.id, 7]]);
      expect(await stockOf(product.id)).toBe(200);
      const columns = await returnColumns(orderId);
      expect(columns.stockRestoredAt).not.toBeNull();
      // Add first: the cart held 4 and the return made it 7. Return first: it held 0, then 3.
      const pair = `${String(columns.cartQuantityBeforeReturn)}->${String(columns.cartQuantityAfterReturn)}`;
      expect(["4->7", "0->3"]).toContain(pair);
      seen.add(pair);
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  it("together they pass 99: the line is 99 (add first) or the returned quantity (add refused), never above 99 or lost", async () => {
    for (let i = 0; i < REPEATS; i += 1) {
      const user = await signedIn();
      const product = await createProduct({ stock: 200 });
      const orderId = await pendingOrder(user, product.id, 60);
      await overdue(orderId);

      const [, added] = await Promise.all([
        returner(orderId),
        addItem(user, { productId: product.id, quantity: 50 }),
      ]);

      const lines = await storedLines(user.userId);
      expect(lines).toHaveLength(1);
      const final = lines[0]?.quantity;
      const columns = await returnColumns(orderId);
      expect(await stockOf(product.id)).toBe(200);
      expect(columns.stockRestoredAt).not.toBeNull();
      if (added.status === 200 || added.status === 201) {
        // Add first (50 in the cart), then the return merged 60 onto it, capped at 99.
        expect(final).toBe(99);
        expect(columns.cartQuantityBeforeReturn).toBe(50);
        expect(columns.cartQuantityAfterReturn).toBe(99);
      } else {
        // Return first (60 in the cart), then the add of 50 would pass 99 and was refused whole.
        expect([400, 409]).toContain(added.status);
        expect(final).toBe(60);
        expect(columns.cartQuantityBeforeReturn).toBe(0);
        expect(columns.cartQuantityAfterReturn).toBe(60);
      }
      expect(final).toBeLessThanOrEqual(99);
      expect(columns.cartQuantityAfterReturn).toBe(final);
    }
  });
});
