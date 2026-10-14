/**
 * The two payment transactions (DATA_MODEL.md section 7.2) against a mocked transaction client:
 * the guard of each status statement, the order of the steps and locks, that only the request
 * whose guarded update won does anything, and that exactly the claimed items are restored and
 * returned. The same transactions against a real PostgreSQL database, races included, belong in
 * tests/integration (qa, T-033).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db, Prisma } from "@/server/db";

import { failOrder, markOrderPaid } from "./repository";

vi.mock("@/server/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/db")>();
  return { ...original, db: { $transaction: vi.fn() } };
});

interface Step {
  kind: string;
  text?: string;
  values?: unknown[];
}

const steps: Step[] = [];
let executeResults: number[] = [];
let queryResults: unknown[][] = [];

function sqlOf(strings: TemplateStringsArray, values: unknown[]): Prisma.Sql {
  return Prisma.sql(strings, ...(values as Prisma.Sql[]));
}

const tx = {
  order: { findUnique: vi.fn() },
  cart: { createMany: vi.fn() },
  cartItem: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  payment: { updateMany: vi.fn() },
  $executeRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = sqlOf(strings, values);
    steps.push({
      kind: "execute",
      text: statement.text.replace(/\s+/g, " "),
      values: statement.values,
    });
    return Promise.resolve(executeResults.shift() ?? 0);
  }),
  $queryRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = sqlOf(strings, values);
    steps.push({
      kind: "query",
      text: statement.text.replace(/\s+/g, " "),
      values: statement.values,
    });
    return Promise.resolve(queryResults.shift() ?? []);
  }),
};

const transaction = vi.mocked(db.$transaction);

beforeEach(() => {
  vi.clearAllMocks();
  steps.length = 0;
  executeResults = [];
  queryResults = [];
  transaction.mockImplementation((async (work: (client: typeof tx) => Promise<unknown>) =>
    work(tx)) as never);
  tx.order.findUnique.mockResolvedValue({ userId: "user_buyer" });
  tx.cartItem.findFirst.mockResolvedValue(null);
});

describe("markOrderPaid (PENDING to PAID)", () => {
  it("is guarded by the source state of the table and sets paidAt from the database clock", async () => {
    executeResults = [1];
    await expect(markOrderPaid("order_1", "MOCK-ref")).resolves.toBe(true);
    const [update] = steps;
    expect(update?.text).toContain(`SET "paymentStatus" = 'PAID', "paidAt" = now()`);
    expect(update?.text).toContain(`WHERE "id" = $1 AND "paymentStatus"::text IN ($2)`);
    expect(update?.values).toEqual(["order_1", "PENDING"]);
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { orderId: "order_1" },
      data: { providerReference: "MOCK-ref" },
    });
  });

  it("changes nothing else when the order was no longer PENDING", async () => {
    executeResults = [0];
    await expect(markOrderPaid("order_1", "MOCK-ref")).resolves.toBe(false);
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
  });
});

describe("failOrder (DATA_MODEL 7.2 'Failure', 7.3, 7.5)", () => {
  it("does nothing beyond the guarded update when the order was no longer PENDING", async () => {
    queryResults = [[{ id: "cart_1" }]];
    executeResults = [0];
    await expect(failOrder("order_1", "PROVIDER_DECLINED", "SIMULATED_DECLINE")).resolves.toBe(
      false,
    );
    expect(steps.map((step) => step.kind)).toEqual(["query", "execute"]);
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
    expect(tx.cartItem.create).not.toHaveBeenCalled();
  });

  it("returns false for an order that does not exist, taking no lock", async () => {
    tx.order.findUnique.mockResolvedValue(null);
    await expect(failOrder("nope", "TIMEOUT", "TIMEOUT")).resolves.toBe(false);
    expect(steps).toEqual([]);
  });

  it("locks the cart first, then fails, cancels, claims, restores in product order, returns, records", async () => {
    queryResults = [
      [{ id: "cart_1" }],
      // The claim: two items, out of product order.
      [
        { id: "item_b", productId: "prod_b", quantity: 50 },
        { id: "item_a", productId: "prod_a", quantity: 3 },
      ],
      [{ stock: 3 }], // restore prod_a
      [{ stock: 200 }], // restore prod_b
    ];
    executeResults = [1, 1, 1, 1];
    tx.cartItem.findFirst.mockImplementation((async (query: { where: { productId: string } }) =>
      query.where.productId === "prod_b" ? { id: "line_b", quantity: 60 } : null) as never);

    await expect(failOrder("order_1", "PROVIDER_DECLINED", "SIMULATED_DECLINE")).resolves.toBe(
      true,
    );

    expect(tx.cart.createMany).toHaveBeenCalledWith({
      data: [{ userId: "user_buyer" }],
      skipDuplicates: true,
    });
    const texts = steps.map((step) => step.text ?? "");
    expect(texts[0]).toContain(`FROM "Cart" WHERE "userId" = $1 FOR UPDATE`);
    expect(steps[0]?.values).toEqual(["user_buyer"]);
    expect(texts[1]).toContain(`SET "paymentStatus" = 'FAILED'`);
    expect(texts[1]).toContain(`"paymentStatus"::text IN ($2)`);
    expect(steps[1]?.values).toEqual(["order_1", "PENDING"]);
    expect(texts[2]).toContain(`SET "fulfilmentStatus" = 'CANCELLED'`);
    expect(steps[2]?.values).toEqual(["order_1", "PENDING"]);
    expect(texts[3]).toContain(`SET "stockRestoredAt" = now()`);
    expect(texts[3]).toContain(`oi."stockRestoredAt" IS NULL`);
    // Restores in ascending product id, each by exactly the claimed quantity, with no guard.
    expect(texts[4]).toContain(`SET "stock" = "stock" + $1::int`);
    expect(steps[4]?.values).toEqual([3, "prod_a"]);
    expect(steps[5]?.values).toEqual([50, "prod_b"]);

    // Returns: no line for prod_a (whole), prod_b 60 + 50 capped at 99.
    expect(tx.cartItem.create).toHaveBeenCalledWith({
      data: { cartId: "cart_1", productId: "prod_a", quantity: 3 },
      select: { id: true },
    });
    expect(tx.cartItem.update).toHaveBeenCalledWith({
      where: { id: "line_b" },
      data: { quantity: 99 },
      select: { id: true },
    });
    expect(texts[6]).toContain(`"cartQuantityAfterReturn" IS NULL`);
    expect(steps[6]?.values).toEqual([0, 3, "item_a"]);
    expect(steps[7]?.values).toEqual([60, 99, "item_b"]);
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { orderId: "order_1" },
      data: { failureReason: "SIMULATED_DECLINE" },
    });
  });

  it("items already claimed by an earlier cancel are neither restored nor returned (D-028)", async () => {
    queryResults = [[{ id: "cart_1" }], []];
    executeResults = [1, 1];
    await expect(failOrder("order_1", "TIMEOUT", "TIMEOUT")).resolves.toBe(true);
    expect(steps.filter((step) => step.text?.includes(`"stock" + `))).toEqual([]);
    expect(tx.cartItem.create).not.toHaveBeenCalled();
    expect(tx.cartItem.update).not.toHaveBeenCalled();
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { orderId: "order_1" },
      data: { failureReason: "TIMEOUT" },
    });
  });
});
