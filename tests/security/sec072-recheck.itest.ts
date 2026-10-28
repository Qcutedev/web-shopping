/**
 * SEC-072 independent re-check (docs/SECURITY.md "### SEC-072";
 * docs/reviews/SEC-092-SEC-072-recheck.md), against the real database, 2026-10-29. Owner:
 * security. Fix commits 65d5960, 1995cd7, b35ae6d.
 *
 * The author's sec072-delivery-delay.itest.ts and tests/integration/seller-orders/
 * delivery-delay.test.ts show the 24 h rule on the plain path. This file tries the ways around it:
 *   - a client-sent time (`shippedAt`, `deliveredAt`, `now`) in the status body;
 *   - the admin route with a seller session;
 *   - a burst of concurrent DELIVERED requests just before the age (none may win) and just after
 *     it (exactly one may win);
 *   - a re-ship to restart nothing: SHIPPED again on a SHIPPED order is refused, so a seller cannot
 *     overwrite `shippedAt`.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 *   it(...)  behaviour checked on 2026-10-29 that holds. A failure is a regression.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as adminStatusRoute } from "@/app/api/v1/admin/seller-orders/[id]/status/route";
import { db } from "@/server/db";

import { createOrder, createProduct } from "../helpers/factories";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../integration/auth/support";
import { request } from "../integration/inventory/support";
import { ageShipment, call } from "../integration/seller-orders/support";
import { signedIn, type SignedIn } from "../integration/sellers/support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

/** A seller with one paid seller order moved to SHIPPED through the API; returns its id. */
async function shippedOrder(): Promise<{ seller: SignedIn; id: string }> {
  const seller = await signedIn("SELLER", "APPROVED");
  if (seller.storeId === null) throw new Error("a seller without a store");
  const product = await createProduct({ storeId: seller.storeId, stock: 10 });
  const order = await createOrder({ lines: [{ productId: product.id, quantity: 1 }] });
  const id = order.sellerOrders[0]!.id;
  for (const to of ["PROCESSING", "SHIPPED"]) {
    expect((await call.status(id, { cookie: seller.cookie, body: { to } })).status).toBe(200);
  }
  return { seller, id };
}

async function stateOf(id: string) {
  const row = await db.sellerOrder.findUniqueOrThrow({ where: { id } });
  const shipment = await db.shipment.findUniqueOrThrow({ where: { sellerOrderId: id } });
  return {
    status: row.fulfilmentStatus,
    shippedAt: shipment.shippedAt,
    deliveredAt: shipment.deliveredAt,
  };
}

describe("SEC-072 re-check: no way around the 24 h delivery rule", () => {
  it("a client-sent time in the DELIVERED or SHIPPED body is 400 and changes nothing", async () => {
    const { seller, id } = await shippedOrder();
    const before = await stateOf(id);
    const old = "2020-01-01T00:00:00.000Z";
    for (const body of [
      { to: "DELIVERED", shippedAt: old },
      { to: "DELIVERED", deliveredAt: old },
      { to: "DELIVERED", now: old },
      { to: "SHIPPED", shippedAt: old },
    ]) {
      const answer = await call.status(id, { cookie: seller.cookie, body });
      expect(answer.status, JSON.stringify(body)).toBe(400);
    }
    expect(await stateOf(id)).toEqual(before);
  });

  it("SHIPPED again on a SHIPPED order is 409: shippedAt cannot be rewritten", async () => {
    const { seller, id } = await shippedOrder();
    const before = await stateOf(id);
    const again = await call.status(id, { cookie: seller.cookie, body: { to: "SHIPPED" } });
    expect(again.status).toBe(409);
    expect(await stateOf(id)).toEqual(before);
  });

  it("the seller's own session on the admin status route is 403", async () => {
    const { seller, id } = await shippedOrder();
    const answer = await adminStatusRoute(
      request("POST", `/api/v1/admin/seller-orders/${id}/status`, {
        cookie: seller.cookie,
        body: { to: "DELIVERED" },
      }),
      { params: Promise.resolve({ id }) } as never,
    );
    expect(answer.status).toBe(403);
    expect((await stateOf(id)).status).toBe("SHIPPED");
  });

  it("six concurrent DELIVERED one minute short of the age: all 409, nothing written", async () => {
    const { seller, id } = await shippedOrder();
    await ageShipment(id, 24 * 60 - 1);
    const answers = await Promise.all(
      Array.from({ length: 6 }, () =>
        call.status(id, { cookie: seller.cookie, body: { to: "DELIVERED" } }),
      ),
    );
    expect(answers.map((answer) => answer.status)).toEqual([409, 409, 409, 409, 409, 409]);
    const state = await stateOf(id);
    expect(state.status).toBe("SHIPPED");
    expect(state.deliveredAt).toBeNull();
  });

  it("six concurrent DELIVERED after the age: exactly one 200, the rest 409; one delivery time", async () => {
    const { seller, id } = await shippedOrder();
    await ageShipment(id);
    const answers = await Promise.all(
      Array.from({ length: 6 }, () =>
        call.status(id, { cookie: seller.cookie, body: { to: "DELIVERED" } }),
      ),
    );
    const statuses = answers.map((answer) => answer.status).sort();
    expect(statuses).toEqual([200, 409, 409, 409, 409, 409]);
    const state = await stateOf(id);
    expect(state.status).toBe("DELIVERED");
    expect(state.deliveredAt).not.toBeNull();
    expect(state.deliveredAt!.getTime()).toBeGreaterThanOrEqual(
      state.shippedAt.getTime() + 24 * 60 * 60 * 1000,
    );
  });
});
