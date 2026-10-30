/**
 * Prisma counts of the notifications module. Each function is one `COUNT` statement scoped by an
 * id the service takes from the actor (CLAUDE.md rules 2 and 6); none writes.
 */
import { db } from "@/server/db";

/** Seller orders of the customer's orders that are on their way. */
export function countShippedForCustomer(userId: string): Promise<number> {
  return db.sellerOrder.count({
    where: { fulfilmentStatus: "SHIPPED", order: { userId } },
  });
}

/** Paid seller orders of the store that wait to be packed or shipped. */
export function countToShipForStore(storeId: string): Promise<number> {
  return db.sellerOrder.count({
    where: {
      storeId,
      fulfilmentStatus: { in: ["PENDING", "PROCESSING"] },
      order: { paymentStatus: "PAID" },
    },
  });
}

export function countPendingApplications(): Promise<number> {
  return db.sellerApplication.count({ where: { status: "PENDING" } });
}

export function countPendingProducts(): Promise<number> {
  return db.product.count({ where: { moderationStatus: "PENDING" } });
}
