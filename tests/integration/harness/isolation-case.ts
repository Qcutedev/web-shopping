/**
 * "Reset leaves no rows between files" (the T-023 acceptance check).
 *
 * Each file that calls `defineIsolationFile` first asserts that it started on an empty database
 * and then leaves rows, a used sequence, and changed settings behind, on purpose and without
 * cleaning up. The suite has more test files that write rows than it has workers, so in every
 * run at least one file starts on a database that an earlier file dirtied; if the reset before
 * a file did not run, or missed a table, a sequence, or the settings row, that file fails here.
 *
 * The emptiness is checked twice: with the helper the harness itself uses, and with counts
 * made here through the model API, so that a fault in the helper does not hide a leftover.
 */
import { describe, expect, it } from "vitest";

import { db } from "@/server/db";

import {
  createAuditLog,
  createCartItem,
  createOrder,
  createSession,
} from "../../helpers/factories";
import { findResetLeftovers, INITIAL_SETTINGS } from "../../helpers/reset";

export function defineIsolationFile(label: string): void {
  describe(`isolation file ${label}`, () => {
    it("starts on an empty database", async () => {
      expect(await findResetLeftovers()).toEqual([]);

      expect(await db.user.count()).toBe(0);
      expect(await db.session.count()).toBe(0);
      expect(await db.store.count()).toBe(0);
      expect(await db.category.count()).toBe(0);
      expect(await db.product.count()).toBe(0);
      expect(await db.cart.count()).toBe(0);
      expect(await db.cartItem.count()).toBe(0);
      expect(await db.order.count()).toBe(0);
      expect(await db.sellerOrder.count()).toBe(0);
      expect(await db.orderItem.count()).toBe(0);
      expect(await db.payment.count()).toBe(0);
      expect(await db.auditLog.count()).toBe(0);
      const settings = await db.marketplaceSettings.findMany();
      expect(settings).toHaveLength(1);
      expect(settings[0]).toMatchObject({ ...INITIAL_SETTINGS, updatedById: null });
    });

    it("gets sequence value 1 for its first order, then leaves its rows behind", async () => {
      const first = await createOrder();
      expect(first.order.orderNumber).toMatch(/^OD[0-9]{6}0000001$/);

      // Left behind for whichever file runs next on this worker's database.
      const session = await createSession();
      await createCartItem();
      await createOrder();
      await createAuditLog({ actorId: session.userId, action: `isolation.${label}` });
      await db.marketplaceSettings.update({
        where: { id: 1 },
        data: { flatShippingFeeSatang: 100, commissionRateBps: 100, updatedById: session.userId },
      });

      expect(await db.order.count()).toBe(2);
      expect((await findResetLeftovers()).length).toBeGreaterThan(0);
    });
  });
}
