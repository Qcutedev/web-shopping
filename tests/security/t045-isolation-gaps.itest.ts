/**
 * Security review of T-045 (commit de61504, tests/integration/seller-isolation/endpoints.test.ts),
 * 2026-10-21. Owner: security. Three tenant paths that the T-045 matrix does not exercise, written
 * from CLAUDE.md rule 6 and API_CONTRACTS.md sections 5.7.3 and 5.7.4, not from the T-045 cases:
 *
 *   1. `POST /seller/orders/{id}/status` to `DELIVERED` on a foreign seller order that is `SHIPPED`
 *      (the only state from which that move is valid; T-045 never sends `DELIVERED`);
 *   2. the same route to `SHIPPED` on a foreign seller order that is `PROCESSING` (T-045 sends
 *      `SHIPPED` only to orders in states where the move is invalid anyway);
 *   3. `GET /seller/summary` `lowStockCount` and `soldOutCount` (removing the store scope from that
 *      one statement passed all 32 T-045 cases on 2026-10-21; seller-orders/endpoints.test.ts
 *      catches it, this file pins it next to the isolation rule).
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 *   it(...)  behaviour checked on 2026-10-21 that holds. A failure is a regression.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";

import {
  createCategory,
  createOrder,
  createProduct,
  createShipment,
  MISSING_ID,
} from "../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../helpers/snapshot";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../integration/auth/support";
import { ageShipment, call } from "../integration/seller-orders/support";
import { json, signedIn, type SignedIn } from "../integration/sellers/support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

type Seller = SignedIn & { storeId: string };

async function seller(): Promise<Seller> {
  const who = await signedIn("SELLER", "APPROVED");
  if (who.storeId === null) throw new Error("a seller without a store");
  return { ...who, storeId: who.storeId };
}

/** A paid order of one product of `storeId`; returns the store's seller order id. */
async function paidSellerOrder(storeId: string): Promise<string> {
  const product = await createProduct({ storeId, stock: 10 });
  const order = await createOrder({ lines: [{ productId: product.id, quantity: 1 }] });
  const part = order.sellerOrders.find((candidate) => candidate.storeId === storeId);
  if (part === undefined) throw new Error("no seller order for the store");
  return part.id;
}

async function errorOf(response: Response): Promise<unknown> {
  const body = await json<{ error: { code: string; message: string; details: unknown } }>(
    response.clone(),
  );
  const { code, message, details } = body.error;
  return { status: response.status, code, message, details };
}

function snapshot() {
  return snapshotDatabase({ excludeTables: ["Session"] });
}

describe("T-045 gaps: foreign seller order moves from a state where the move is valid", () => {
  it("DELIVERED on a foreign SHIPPED seller order is 404, the same as a missing id, and changes nothing", async () => {
    const attacker = await seller();
    const victim = await seller();
    const victimPart = await paidSellerOrder(victim.storeId);
    await db.sellerOrder.update({
      where: { id: victimPart },
      data: { fulfilmentStatus: "SHIPPED" },
    });
    await createShipment({ sellerOrderId: victimPart });
    // SEC-072: old enough for the owner's control move below (a database time shift).
    await ageShipment(victimPart);

    const before = await snapshot();
    const foreign = await call.status(victimPart, {
      cookie: attacker.cookie,
      body: { to: "DELIVERED" },
    });
    const missing = await call.status(MISSING_ID, {
      cookie: attacker.cookie,
      body: { to: "DELIVERED" },
    });
    expect(foreign.status).toBe(404);
    expect(await errorOf(foreign)).toEqual(await errorOf(missing));
    expect(diffSnapshots(before, await snapshot())).toEqual([]);
    const shipment = await db.shipment.findFirstOrThrow({ where: { sellerOrderId: victimPart } });
    expect(shipment.deliveredAt).toBeNull();

    // Control: the owner can make the same move, so the 404 above is about ownership.
    const own = await call.status(victimPart, { cookie: victim.cookie, body: { to: "DELIVERED" } });
    expect(own.status).toBe(200);
  });

  it("SHIPPED on a foreign PROCESSING seller order is 404, the same as a missing id, and writes no shipment", async () => {
    const attacker = await seller();
    const victim = await seller();
    const victimPart = await paidSellerOrder(victim.storeId);
    await db.sellerOrder.update({
      where: { id: victimPart },
      data: { fulfilmentStatus: "PROCESSING" },
    });

    const shipBody = { to: "SHIPPED", carrierName: "Evil Express", trackingNumber: "EVIL-2" };
    const before = await snapshot();
    const foreign = await call.status(victimPart, { cookie: attacker.cookie, body: shipBody });
    const missing = await call.status(MISSING_ID, { cookie: attacker.cookie, body: shipBody });
    expect(foreign.status).toBe(404);
    expect(await errorOf(foreign)).toEqual(await errorOf(missing));
    expect(diffSnapshots(before, await snapshot())).toEqual([]);
    expect(await db.shipment.count({ where: { sellerOrderId: victimPart } })).toBe(0);

    const own = await call.status(victimPart, {
      cookie: victim.cookie,
      body: { to: "SHIPPED" },
    });
    expect(own.status).toBe(200);
  });
});

describe("T-045 gaps: summary stock figures are the session's store's only", () => {
  it("another store's low-stock and sold-out products do not change lowStockCount or soldOutCount", async () => {
    const attacker = await seller();
    const victim = await seller();
    const category = await createCategory();
    // The attacker: one low-stock and one sold-out product of its own.
    await createProduct({ storeId: attacker.storeId, categoryId: category.id, stock: 2 });
    await createProduct({ storeId: attacker.storeId, categoryId: category.id, stock: 0 });

    type Summary = { lowStockCount: number; soldOutCount: number };
    const read = async (cookie: string): Promise<Summary> =>
      (await json<{ data: Summary }>(await call.summary(cookie))).data;

    const base = await read(attacker.cookie);
    expect(base).toMatchObject({ lowStockCount: 1, soldOutCount: 1 });

    for (const stock of [1, 3, 0, 0]) {
      await createProduct({ storeId: victim.storeId, categoryId: category.id, stock });
    }
    expect(await read(attacker.cookie)).toMatchObject({ lowStockCount: 1, soldOutCount: 1 });
    // Control: the victim's own summary counts them, so the figures are real.
    expect(await read(victim.cookie)).toMatchObject({ lowStockCount: 2, soldOutCount: 2 });
  });
});
