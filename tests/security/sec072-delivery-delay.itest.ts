/**
 * SEC-072 reproduction (docs/SECURITY.md "### SEC-072"), against the real database. The finding:
 * a seller moved its own paid seller order PENDING, PROCESSING, SHIPPED, DELIVERED in three
 * requests within a second, which unlocks a review (BR-11) for an order it placed through a second
 * account. Remediation (1), chosen by the owner: a seller may set DELIVERED only
 * SELLER_DELIVERY_MIN_HOURS_AFTER_SHIPPED (24) hours after Shipment.shippedAt, by the database
 * clock in the guarded statement.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 *   it(...)  the reproduction steps now end in a refusal. A failure is a regression.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";

import { createOrder, createProduct } from "../helpers/factories";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../integration/auth/support";
import { ageShipment, call } from "../integration/seller-orders/support";
import { json, signedIn } from "../integration/sellers/support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

describe("SEC-072: a seller cannot mark its order delivered in seconds", () => {
  it("PROCESSING, SHIPPED, DELIVERED back to back: the third is 409 CONFLICT DELIVERY_TOO_EARLY", async () => {
    const seller = await signedIn("SELLER", "APPROVED");
    if (seller.storeId === null) throw new Error("a seller without a store");
    // The buyer stands for the seller's second customer account; the mock provider made it PAID.
    const product = await createProduct({ storeId: seller.storeId, stock: 10 });
    const order = await createOrder({ lines: [{ productId: product.id, quantity: 1 }] });
    const id = order.sellerOrders[0]!.id;

    const answers: number[] = [];
    let last: Response | undefined;
    for (const to of ["PROCESSING", "SHIPPED", "DELIVERED"]) {
      last = await call.status(id, { cookie: seller.cookie, body: { to } });
      answers.push(last.status);
    }
    expect(answers).toEqual([200, 200, 409]);
    const { error } = await json<{ error: { code: string; details: unknown } }>(last!);
    expect(error).toMatchObject({ code: "CONFLICT", details: { reason: "DELIVERY_TOO_EARLY" } });

    // The review condition of BR-11 stays unmet: still SHIPPED, no delivery time.
    const row = await db.sellerOrder.findUniqueOrThrow({ where: { id } });
    expect(row.fulfilmentStatus).toBe("SHIPPED");
    const shipment = await db.shipment.findUniqueOrThrow({ where: { sellerOrderId: id } });
    expect(shipment.deliveredAt).toBeNull();
  });

  it("23 hours 59 minutes after SHIPPED is still refused; 24 hours after is allowed", async () => {
    const seller = await signedIn("SELLER", "APPROVED");
    if (seller.storeId === null) throw new Error("a seller without a store");
    const product = await createProduct({ storeId: seller.storeId, stock: 10 });
    const order = await createOrder({ lines: [{ productId: product.id, quantity: 1 }] });
    const id = order.sellerOrders[0]!.id;
    for (const to of ["PROCESSING", "SHIPPED"]) {
      expect((await call.status(id, { cookie: seller.cookie, body: { to } })).status).toBe(200);
    }
    await ageShipment(id, 24 * 60 - 1);
    const early = await call.status(id, { cookie: seller.cookie, body: { to: "DELIVERED" } });
    expect(early.status).toBe(409);
    await ageShipment(id, 1);
    const late = await call.status(id, { cookie: seller.cookie, body: { to: "DELIVERED" } });
    expect(late.status).toBe(200);
  });
});
