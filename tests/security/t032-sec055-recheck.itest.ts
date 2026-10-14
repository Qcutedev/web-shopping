/**
 * Security re-check of SEC-055 item 2 (2026-10-14), against the worker's real test database.
 * Owner: security. Review: docs/reviews/T-032-security.md, section "Re-check of SEC-055 item 2".
 * Run with
 * `pnpm exec vitest run --config vitest.integration.config.mts tests/security/t032-sec055-recheck.itest.ts`.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 * The cases already in the repository inject the failure by making `completeOrderPayment` reject
 * before it opens a transaction. These cases make the real payment transaction fail on the real
 * database instead: a second connection holds a row lock that the payment transaction needs for
 * longer than PAYMENT_TRANSACTION_OPTIONS.timeout (20 s), so Prisma ends it. In the decline case
 * the transaction has already written three things (the order FAILED, the seller orders
 * CANCELLED, the items claimed) when it blocks, so the case also shows that a failure part-way
 * leaves no partial effect behind.
 *
 * Secure behaviour asserted: the order that committed is answered 201 with `PENDING`, never 500;
 * its stock stays taken; nothing of the failed payment transaction survives; one error line with
 * the error class only.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { checkout } from "@/modules/checkout";
import type { ChargeResult, PaymentProvider } from "@/modules/payments";
import { getPaymentProvider } from "@/modules/payments";
import { db } from "@/server/db";
import type { Logger } from "@/server/logger";

import { createProduct } from "../helpers/factories";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../integration/auth/support";
import { newKey, postCheckout, readyToBuy, signedIn } from "../integration/checkout/support";

vi.mock("@/modules/payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/payments")>();
  return { ...actual, getPaymentProvider: vi.fn(actual.getPaymentProvider) };
});

/** Longer than PAYMENT_TRANSACTION_OPTIONS.timeout (20 s), so the payment transaction ends. */
const HOLD_MS = 24_000;
const CASE_TIMEOUT_MS = 90_000;

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

afterEach(() => {
  vi.mocked(getPaymentProvider).mockReset();
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface Holder {
  /** Resolves once the row lock is held. */
  acquired: Promise<void>;
  /** Resolves when the holding transaction has ended. */
  done: Promise<void>;
}

/** Holds `SELECT ... FOR UPDATE` on one row of "Product" or "Order" in a second connection. */
function holdRowLock(table: "Product" | "Order", id: string): Holder {
  let signal: () => void = () => undefined;
  const acquired = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const done = db
    .$transaction(
      async (tx) => {
        if (table === "Product") {
          await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${id} FOR UPDATE`;
        } else {
          await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${id} FOR UPDATE`;
        }
        signal();
        await sleep(HOLD_MS);
      },
      { maxWait: 5_000, timeout: HOLD_MS + 20_000 },
    )
    .then(() => undefined);
  return { acquired, done };
}

/**
 * A provider that, before it answers, has a second connection lock the row the payment
 * transaction will need. `holders` receives the holder so the case can wait for it.
 */
function lockingProvider(
  answer: ChargeResult,
  table: "Product" | "Order",
  rowId: (orderId: string) => Promise<string>,
  holders: Holder[],
): PaymentProvider {
  return {
    name: "MOCK",
    isSimulated: true,
    charge: async ({ orderId }) => {
      const holder = holdRowLock(table, await rowId(orderId));
      holders.push(holder);
      await holder.acquired;
      return answer;
    },
  };
}

async function stockOf(productId: string): Promise<number> {
  const row = await db.product.findUniqueOrThrow({
    where: { id: productId },
    select: { stock: true },
  });
  return row.stock;
}

async function paymentEffects(orderId: string) {
  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { paymentStatus: true, paidAt: true },
  });
  const sellerOrders = await db.sellerOrder.findMany({
    where: { orderId },
    select: { fulfilmentStatus: true },
  });
  const restored = await db.orderItem.count({
    where: { sellerOrder: { orderId }, stockRestoredAt: { not: null } },
  });
  const payment = await db.payment.findFirstOrThrow({
    where: { orderId },
    select: { failureReason: true },
  });
  return { order, sellerOrders, restored, payment };
}

describe("SEC-055 item 2 re-check: the real payment transaction fails after the order committed", () => {
  it(
    "a decline whose transaction times out part-way: 201 PENDING, stock taken, no partial failure, cart not refilled",
    async () => {
      const user = await signedIn();
      const product = await createProduct({ stock: 10 });
      const { addressId, cartId } = await readyToBuy(user, [
        { productId: product.id, quantity: 3 },
      ]);
      const holders: Holder[] = [];
      vi.mocked(getPaymentProvider).mockReturnValue(
        lockingProvider(
          { outcome: "DECLINED", failureReason: "SIMULATED_DECLINE" },
          "Product",
          async () => product.id,
          holders,
        ),
      );

      const key = newKey();
      const answer = await postCheckout(
        user,
        { addressId, paymentMethod: "MOCK", mockOutcome: "FAIL" },
        { key },
      );
      await Promise.all(holders.map((holder) => holder.done));

      expect(holders).toHaveLength(1);
      expect(answer.status).toBe(201);
      expect(answer.body.data.paymentStatus).toBe("PENDING");
      const orderId = answer.body.data.id;

      const effects = await paymentEffects(orderId);
      expect(effects.order).toEqual({ paymentStatus: "PENDING", paidAt: null });
      expect(effects.sellerOrders.map((row) => row.fulfilmentStatus)).toEqual(["PENDING"]);
      expect(effects.restored).toBe(0);
      expect(effects.payment.failureReason).toBeNull();
      expect(await stockOf(product.id)).toBe(7);
      expect(await db.cartItem.count({ where: { cartId } })).toBe(0);

      // A repeat with the key answers the same order and charges nothing.
      vi.mocked(getPaymentProvider).mockReset();
      const charge = vi.fn();
      vi.mocked(getPaymentProvider).mockReturnValue({ name: "MOCK", isSimulated: true, charge });
      const repeat = await postCheckout(user, { addressId, paymentMethod: "MOCK" }, { key });
      expect(repeat.status).toBe(200);
      expect(repeat.body.data.id).toBe(orderId);
      expect(repeat.body.data.paymentStatus).toBe("PENDING");
      expect(charge).not.toHaveBeenCalled();
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "a confirmation whose transaction times out: PENDING, not PAID, and one error line with the class only",
    async () => {
      const user = await signedIn();
      const product = await createProduct({ stock: 5 });
      const { addressId } = await readyToBuy(user, [{ productId: product.id, quantity: 2 }]);
      const holders: Holder[] = [];
      const provider = lockingProvider(
        { outcome: "PAID", providerReference: "MOCK-recheck" },
        "Order",
        async (orderId) => orderId,
        holders,
      );
      const lines: { level: string; message: string; fields: unknown }[] = [];
      const log: Logger = {
        debug: (message, fields) => lines.push({ level: "debug", message, fields }),
        info: (message, fields) => lines.push({ level: "info", message, fields }),
        warn: (message, fields) => lines.push({ level: "warn", message, fields }),
        error: (message, fields) => lines.push({ level: "error", message, fields }),
        child: () => log,
      };

      const result = await checkout(
        { userId: user.userId, role: "CUSTOMER", storeId: null, storeStatus: null },
        newKey(),
        { addressId, paymentMethod: "MOCK", mockOutcome: "SUCCESS" },
        { log, provider },
      );
      await Promise.all(holders.map((holder) => holder.done));

      expect(result.created).toBe(true);
      expect(result.order.paymentStatus).toBe("PENDING");
      const effects = await paymentEffects(result.order.id);
      expect(effects.order).toEqual({ paymentStatus: "PENDING", paidAt: null });
      expect(await stockOf(product.id)).toBe(3);
      const reference = await db.payment.findFirstOrThrow({
        where: { orderId: result.order.id },
        select: { providerReference: true },
      });
      expect(reference.providerReference).not.toBe("MOCK-recheck");

      expect(lines).toHaveLength(1);
      expect(lines[0]?.level).toBe("error");
      expect(lines[0]?.message).toBe(
        "Payment outcome could not be recorded; the order stays PENDING",
      );
      const fields = lines[0]?.fields as Record<string, unknown>;
      expect(Object.keys(fields).sort()).toEqual([
        "component",
        "errorClass",
        "outcome",
        "provider",
      ]);
      expect(fields).toMatchObject({ component: "checkout", provider: "MOCK", outcome: "PAID" });
      expect(fields.errorClass).toMatch(/^[A-Za-z][A-Za-z0-9]*$/);
      expect(JSON.stringify(lines)).not.toContain(result.order.id);
      expect(JSON.stringify(lines)).not.toContain(user.userId);
    },
    CASE_TIMEOUT_MS,
  );
});
