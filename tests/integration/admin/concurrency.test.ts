/**
 * T-050, CR-T050-09: races of the admin writes against the worker's real test database
 * (docs/API_CONTRACTS.md sections 3.3 and 5.9; DATA_MODEL.md 7.3 to 7.6; BR-15, BR-20, BR-36).
 *
 * Each case starts two writes with `Promise.all`, so their transactions overlap on separate pooled
 * connections, and then asserts what must hold whichever of them the database lets through first:
 * exactly one moves the row, the other is refused with the documented answer, stock is restored
 * at most once, and exactly one audit row exists per accepted admin write. The order in which the
 * two win is not fixed, so every assertion covers both orders.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { failOrderPayment } from "@/modules/orders";
import { db } from "@/server/db";

import { createOrder, createProduct } from "../../helpers/factories";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import { call as sellerProducts } from "../inventory/support";
import { callEndpoint, endpoint, json, type SignedIn, signedIn } from "./support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

let admin: SignedIn;

beforeAll(async () => {
  admin = await signedIn("ADMIN");
});

async function auditRows(targetId: string) {
  return db.auditLog.findMany({ where: { targetId }, orderBy: { createdAt: "asc" } });
}

/** `CODE` or `CODE REASON` of an error answer; `200` for a success. */
async function outcomeOf(response: Response): Promise<string> {
  if (response.status === 200) return "200";
  const body = await json<{ error: { code: string; details?: { reason?: string } } }>(response);
  const reason = body.error.details?.reason;
  return reason === undefined ? body.error.code : `${body.error.code} ${reason}`;
}

describe("admin write races (CR-T050-09)", () => {
  it("(a) two admins deactivating each other: one wins, the last active admin stays active", async () => {
    const first = await signedIn("ADMIN");
    const second = await signedIn("ADMIN");
    // Only the two racers are active admins: every other admin is switched off for the case and
    // switched back on after it (their sessions stay; the guard re-reads the flag).
    const others = await db.user.findMany({
      where: { role: "ADMIN", isActive: true, id: { notIn: [first.userId, second.userId] } },
      select: { id: true },
    });
    await db.user.updateMany({
      where: { id: { in: others.map((user) => user.id) } },
      data: { isActive: false },
    });
    try {
      const [byFirst, bySecond] = await Promise.all([
        callEndpoint(endpoint("POST deactivate"), { cookie: first.cookie, id: second.userId }),
        callEndpoint(endpoint("POST deactivate"), { cookie: second.cookie, id: first.userId }),
      ]);
      const outcomes = [await outcomeOf(byFirst), await outcomeOf(bySecond)];
      // The loser is refused under the admin row locks (LAST_ADMIN), or, when its request reached
      // the session guard after the winner's commit deleted its sessions, as a guest (401).
      expect(outcomes.filter((outcome) => outcome === "200")).toHaveLength(1);
      const loser = outcomes.find((outcome) => outcome !== "200");
      expect(["CONFLICT LAST_ADMIN", "UNAUTHENTICATED"]).toContain(loser);

      const racers = await db.user.findMany({
        where: { id: { in: [first.userId, second.userId] } },
        select: { id: true, isActive: true },
      });
      expect(racers.filter((user) => user.isActive)).toHaveLength(1);
      expect(await db.user.count({ where: { role: "ADMIN", isActive: true } })).toBe(1);
      const audits = await db.auditLog.findMany({
        where: { action: "USER_DEACTIVATED", targetId: { in: [first.userId, second.userId] } },
      });
      expect(audits).toHaveLength(1);
      const deactivated = racers.find((user) => !user.isActive)!;
      expect(audits[0]).toMatchObject({ targetId: deactivated.id });
      expect(audits[0]!.actorId).not.toBe(deactivated.id);
      expect(await db.session.count({ where: { userId: deactivated.id } })).toBe(0);
    } finally {
      await db.user.updateMany({
        where: { id: { in: others.map((user) => user.id) } },
        data: { isActive: true },
      });
    }
  });

  it("(b) two admins cancelling the same part: one 200, one 409, stock restored once, one audit row", async () => {
    const product = await createProduct({ stock: 10 });
    const created = await createOrder({ lines: [{ productId: product.id, quantity: 3 }] });
    const sellerOrderId = created.sellerOrders[0]!.id;
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(7);
    const otherAdmin = await signedIn("ADMIN");

    const responses = await Promise.all(
      [admin, otherAdmin].map((who) =>
        callEndpoint(endpoint("POST seller order status"), {
          cookie: who.cookie,
          id: sellerOrderId,
          body: { to: "CANCELLED" },
        }),
      ),
    );
    const outcomes = (await Promise.all(responses.map(outcomeOf))).sort();
    expect(outcomes).toEqual(["200", "INVALID_STATE_TRANSITION"]);

    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(10);
    expect(
      (await db.sellerOrder.findUniqueOrThrow({ where: { id: sellerOrderId } })).fulfilmentStatus,
    ).toBe("CANCELLED");
    const audit = await auditRows(sellerOrderId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "SELLER_ORDER_CANCELLED",
      metadata: { stockRestoredItems: 1 },
    });
  });

  it("(c) an admin cancel racing a payment failure: exactly one moves the part, stock ends at its start", async () => {
    const product = await createProduct({ stock: 6 });
    const pending = await createOrder({
      paymentStatus: "PENDING",
      lines: [{ productId: product.id, quantity: 2 }],
    });
    const sellerOrderId = pending.sellerOrders[0]!.id;
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(4);

    const [cancel, failed] = await Promise.all([
      callEndpoint(endpoint("POST seller order status"), {
        cookie: admin.cookie,
        id: sellerOrderId,
        body: { to: "CANCELLED" },
      }),
      failOrderPayment(pending.order.id, "SIMULATED_DECLINE"),
    ]);
    const cancelOutcome = await outcomeOf(cancel);

    // The failure always finishes the order (the part may already be cancelled, D-028).
    expect(failed).toBe(true);
    expect(["200", "INVALID_STATE_TRANSITION"]).toContain(cancelOutcome);
    expect(
      (await db.order.findUniqueOrThrow({ where: { id: pending.order.id } })).paymentStatus,
    ).toBe("FAILED");
    expect(
      (await db.sellerOrder.findUniqueOrThrow({ where: { id: sellerOrderId } })).fulfilmentStatus,
    ).toBe("CANCELLED");
    // Restored exactly once, whichever won: never above the starting value (BR-15).
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(6);
    const audit = await auditRows(sellerOrderId);
    const cartItems = await db.cartItem.count({
      where: { cart: { userId: pending.order.userId } },
    });
    if (cancelOutcome === "200") {
      // The admin cancelled first: one audit row; the failure returns none of the part's items.
      expect(audit.map((row) => row.action)).toEqual(["SELLER_ORDER_CANCELLED"]);
      expect(audit[0]).toMatchObject({ metadata: { stockRestoredItems: 1 } });
      expect(cartItems).toBe(0);
    } else {
      // The failure came first: the admin's cancel wrote nothing; the item went back to the cart.
      expect(audit).toHaveLength(0);
      expect(cartItems).toBe(1);
    }
  });

  it("(d) an approve racing a seller's content edit never approves a revision the admin did not see", async () => {
    const seller = await signedIn("SELLER", "APPROVED");
    const product = await createProduct({
      storeId: seller.storeId!,
      moderationStatus: "PENDING",
      contentRevision: 1,
    });

    const [approve, edit] = await Promise.all([
      callEndpoint(endpoint("POST approve product"), {
        cookie: admin.cookie,
        id: product.id,
        body: { contentRevision: 1 },
      }),
      sellerProducts.patch(product.id, {
        cookie: seller.cookie,
        body: { title: `Edited title ${Date.now()}` },
      }),
    ]);
    const approveOutcome = await outcomeOf(approve);
    expect(edit.status).toBe(200);
    expect(["200", "CONFLICT STALE_REVISION"]).toContain(approveOutcome);

    // Whichever won, the edited content (revision 2) waits in the queue unapproved.
    const stored = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(stored).toMatchObject({ moderationStatus: "PENDING", contentRevision: 2 });
    const audit = await auditRows(product.id);
    if (approveOutcome === "200") {
      expect(audit.map((row) => row.action)).toEqual(["PRODUCT_APPROVED"]);
      expect(audit[0]).toMatchObject({ metadata: { contentRevision: 1 } });
    } else {
      expect(audit).toHaveLength(0);
    }
  });
});
