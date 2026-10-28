/**
 * SEC-072 (owner decision, remediation 1): a seller may move its seller order from `SHIPPED` to
 * `DELIVERED` only `SELLER_DELIVERY_MIN_HOURS_AFTER_SHIPPED` (24) hours after `Shipment.shippedAt`,
 * compared with the database clock inside the status change's transaction; earlier is
 * `409 CONFLICT`, reason `DELIVERY_TOO_EARLY`, and nothing changes (docs/API_CONTRACTS.md sections
 * 2.3 and 5.7.3).
 *
 * Time is moved in the database (`ageShipment`, or a `shippedAt` written inside the same
 * transaction as the check), never by weakening the check or faking the process clock: the check
 * reads no process time at all.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { markShipmentDelivered, SELLER_DELIVERY_MIN_HOURS_AFTER_SHIPPED } from "@/modules/orders";
import {
  markShipmentDeliveredBySeller,
  readSellerDeliveryEligibility,
} from "@/modules/orders/seller-repository";
import { db } from "@/server/db";

import { createOrder, createProduct } from "../../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../../helpers/snapshot";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import { ageShipment, call, json, type SignedIn, signedIn } from "./support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

const MIN_MINUTES = SELLER_DELIVERY_MIN_HOURS_AFTER_SHIPPED * 60;

function snapshot() {
  return snapshotDatabase({ excludeTables: ["Session"] });
}

async function seller(
  status: "APPROVED" | "SUSPENDED" = "APPROVED",
): Promise<SignedIn & { storeId: string }> {
  const who = await signedIn("SELLER", status);
  if (who.storeId === null) throw new Error("a seller without a store");
  return { ...who, storeId: who.storeId };
}

/** A paid order of the store, moved to SHIPPED through the seller's own endpoint. */
async function shippedSellerOrder(me: SignedIn & { storeId: string }): Promise<string> {
  const product = await createProduct({ storeId: me.storeId, stock: 10 });
  const created = await createOrder({ lines: [{ productId: product.id, quantity: 1 }] });
  const id = created.sellerOrders[0]!.id;
  for (const to of ["PROCESSING", "SHIPPED"]) {
    expect((await call.status(id, { cookie: me.cookie, body: { to } })).status).toBe(200);
  }
  return id;
}

function deliver(id: string, cookie: string) {
  return call.status(id, { cookie, body: { to: "DELIVERED" } });
}

async function errorOf(response: Response): Promise<{ code: string; details: unknown }> {
  const { error } = await json<{ error: { code: string; details: unknown } }>(response);
  return { code: error.code, details: error.details };
}

const TOO_EARLY = { code: "CONFLICT", details: { reason: "DELIVERY_TOO_EARLY" } };

async function shipmentOf(sellerOrderId: string) {
  return db.shipment.findUniqueOrThrow({ where: { sellerOrderId } });
}

describe("SEC-072: POST /seller/orders/{id}/status to DELIVERED, minimum age after SHIPPED", () => {
  it("at once after SHIPPED: 409 CONFLICT DELIVERY_TOO_EARLY, nothing changes", async () => {
    const me = await seller();
    const id = await shippedSellerOrder(me);
    const before = await snapshot();
    const response = await deliver(id, me.cookie);
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toEqual(TOO_EARLY);
    expect(diffSnapshots(before, await snapshot())).toEqual([]);
    expect((await shipmentOf(id)).deliveredAt).toBeNull();
  });

  it("one minute short of the minimum: still refused, nothing changes", async () => {
    const me = await seller();
    const id = await shippedSellerOrder(me);
    await ageShipment(id, MIN_MINUTES - 1);
    const before = await snapshot();
    const response = await deliver(id, me.cookie);
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toEqual(TOO_EARLY);
    expect(diffSnapshots(before, await snapshot())).toEqual([]);
  });

  it("at the minimum (shifted by exactly 24 hours before the request): 200, DELIVERED, deliveredAt by the database clock", async () => {
    const me = await seller();
    const id = await shippedSellerOrder(me);
    await ageShipment(id, MIN_MINUTES);
    const [clock] = await db.$queryRaw<{ dbNow: Date }[]>`SELECT now() AS "dbNow"`;
    const dbNow = clock!.dbNow;
    const response = await deliver(id, me.cookie);
    expect(response.status).toBe(200);
    const { data } = await json<{ data: { fulfilmentStatus: string } }>(response);
    expect(data.fulfilmentStatus).toBe("DELIVERED");
    const shipment = await shipmentOf(id);
    expect(shipment.deliveredAt).not.toBeNull();
    expect(shipment.deliveredAt!.getTime()).toBeGreaterThanOrEqual(dbNow.getTime());
  });

  it("well after the minimum: 200; a suspended store too (BR-14)", async () => {
    const me = await seller("SUSPENDED");
    const id = await shippedSellerOrder(me);
    await ageShipment(id, MIN_MINUTES * 3);
    expect((await deliver(id, me.cookie)).status).toBe(200);
  });

  it("a suspended store is refused too early, like an approved one", async () => {
    const me = await seller("SUSPENDED");
    const id = await shippedSellerOrder(me);
    const response = await deliver(id, me.cookie);
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toEqual(TOO_EARLY);
  });

  it("another store's young SHIPPED seller order is still 404 (ownership before age)", async () => {
    const owner = await seller();
    const other = await seller();
    const id = await shippedSellerOrder(owner);
    const response = await deliver(id, other.cookie);
    expect(response.status).toBe(404);
  });

  it("two DELIVERED at the same time after the minimum: one 200, one 409 INVALID_STATE_TRANSITION, delivered once", async () => {
    const me = await seller();
    const id = await shippedSellerOrder(me);
    await ageShipment(id);
    const responses = await Promise.all([deliver(id, me.cookie), deliver(id, me.cookie)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const refused = responses.find((response) => response.status === 409)!;
    expect((await errorOf(refused)).code).toBe("INVALID_STATE_TRANSITION");
    expect((await db.sellerOrder.findUniqueOrThrow({ where: { id } })).fulfilmentStatus).toBe(
      "DELIVERED",
    );
    expect(await db.shipment.count({ where: { sellerOrderId: id } })).toBe(1);
  });

  it("five DELIVERED at the same time before the minimum: all refused, nothing changes", async () => {
    const me = await seller();
    const id = await shippedSellerOrder(me);
    const before = await snapshot();
    const responses = await Promise.all(Array.from({ length: 5 }, () => deliver(id, me.cookie)));
    for (const response of responses) {
      expect(response.status).toBe(409);
      expect(await errorOf(response)).toEqual(TOO_EARLY);
    }
    expect(diffSnapshots(before, await snapshot())).toEqual([]);
  });

  it("the admin's write is unchanged: markShipmentDelivered marks a young shipment at once", async () => {
    // SEC-072 binds the seller only. The admin's endpoint is pinned by
    // tests/integration/admin/endpoints.test.ts; here the shared write it calls is checked to
    // carry no age condition.
    const me = await seller();
    const id = await shippedSellerOrder(me);
    expect(await db.$transaction((tx) => markShipmentDelivered(tx, id))).toBe(true);
    expect((await shipmentOf(id)).deliveredAt).not.toBeNull();
  });
});

describe("SEC-072: the database statements (boundary, guarded write)", () => {
  /**
   * Inside one transaction `now()` is fixed, so `shippedAt` written there sits at an exact
   * distance from the `now()` the check reads. `shippedAt` has millisecond precision, so the
   * boundary is written as `date_trunc('milliseconds', now())` minus the minimum: at most the
   * minimum's age, never older by a whole millisecond.
   */
  async function judgeAt(id: string, offset: "AT" | "ONE_MS_YOUNGER"): Promise<string | null> {
    return db.$transaction(async (tx) => {
      if (offset === "AT") {
        await tx.$executeRaw`
          UPDATE "Shipment"
             SET "shippedAt" = date_trunc('milliseconds', now())
                               - ${SELLER_DELIVERY_MIN_HOURS_AFTER_SHIPPED}::int * interval '1 hour'
           WHERE "sellerOrderId" = ${id}`;
      } else {
        await tx.$executeRaw`
          UPDATE "Shipment"
             SET "shippedAt" = date_trunc('milliseconds', now())
                               - ${SELLER_DELIVERY_MIN_HOURS_AFTER_SHIPPED}::int * interval '1 hour'
                               + interval '1 millisecond'
           WHERE "sellerOrderId" = ${id}`;
      }
      return readSellerDeliveryEligibility(tx, id, SELLER_DELIVERY_MIN_HOURS_AFTER_SHIPPED);
    });
  }

  it("exactly at the minimum is ELIGIBLE; one millisecond younger is TOO_EARLY", async () => {
    const me = await seller();
    const id = await shippedSellerOrder(me);
    expect(await judgeAt(id, "AT")).toBe("ELIGIBLE");
    expect(await judgeAt(id, "ONE_MS_YOUNGER")).toBe("TOO_EARLY");
  });

  it("the guarded write itself refuses a young shipment, whatever the caller checked", async () => {
    const me = await seller();
    const id = await shippedSellerOrder(me);
    await ageShipment(id, MIN_MINUTES - 1);
    expect(
      await db.$transaction((tx) =>
        markShipmentDeliveredBySeller(tx, id, SELLER_DELIVERY_MIN_HOURS_AFTER_SHIPPED),
      ),
    ).toBe(false);
    expect((await shipmentOf(id)).deliveredAt).toBeNull();
    await ageShipment(id, 1);
    expect(
      await db.$transaction((tx) =>
        markShipmentDeliveredBySeller(tx, id, SELLER_DELIVERY_MIN_HOURS_AFTER_SHIPPED),
      ),
    ).toBe(true);
    expect((await shipmentOf(id)).deliveredAt).not.toBeNull();
  });

  it("no undelivered shipment: the check answers null", async () => {
    const me = await seller();
    const product = await createProduct({ storeId: me.storeId, stock: 10 });
    const created = await createOrder({ lines: [{ productId: product.id, quantity: 1 }] });
    expect(
      await db.$transaction((tx) =>
        readSellerDeliveryEligibility(
          tx,
          created.sellerOrders[0]!.id,
          SELLER_DELIVERY_MIN_HOURS_AFTER_SHIPPED,
        ),
      ),
    ).toBeNull();
  });
});
