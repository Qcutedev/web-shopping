/**
 * Reviews queries (docs/API_CONTRACTS.md section 5.6; DATA_MODEL.md section 6.15; BR-11).
 *
 * Every statement takes the caller's transaction. The order item is found only through the
 * caller's own order (`Order.userId` in the `WHERE`), so an item of another user's order, an item
 * of another order of the caller, and an unknown id are the same "not found". The row is locked
 * (`FOR UPDATE OF oi`) so that two reviews of one item run one after the other: the second sees
 * the first and is refused before its insert; the unique index `Review_orderItemId_key` is the
 * backstop (service.ts).
 *
 * Raw statements are tagged templates with bound parameters only; no SQL text is built from a
 * value. Nothing here logs: a comment is the customer's own text (SECURITY.md SR-04).
 */
import type { DbTransaction, Prisma } from "@/server/db";

import type { FulfilmentStatusValue } from "@/modules/orders/state";

/**
 * Interactive transaction limits of a review insert (DATA_MODEL.md section 21.5, CR-T032-02). The
 * only lock it can wait for is the same item's row held by a concurrent review insert, which runs
 * a few statements; the margin covers a slow database.
 */
export const REVIEW_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

/** The unique index on `Review.orderItemId` (prisma/schema.prisma). */
export const REVIEW_ORDER_ITEM_INDEX = "Review_orderItemId_key";

export interface LockedReviewTarget {
  id: string;
  productId: string;
  fulfilmentStatus: FulfilmentStatusValue;
}

/**
 * Locks the order item `itemId` of the order `orderId` when that order is `userId`'s, and reads
 * its product and the status of its seller order. Null for every other case.
 */
export async function lockOwnOrderItem(
  tx: DbTransaction,
  userId: string,
  orderId: string,
  itemId: string,
): Promise<LockedReviewTarget | null> {
  const rows = await tx.$queryRaw<LockedReviewTarget[]>`
    SELECT oi."id", oi."productId", so."fulfilmentStatus"::text AS "fulfilmentStatus"
      FROM "OrderItem" oi
      JOIN "SellerOrder" so ON so."id" = oi."sellerOrderId"
      JOIN "Order" o ON o."id" = so."orderId"
     WHERE oi."id" = ${itemId}
       AND so."orderId" = ${orderId}
       AND o."userId" = ${userId}
       FOR UPDATE OF oi`;
  return rows[0] ?? null;
}

export async function orderItemHasReview(tx: DbTransaction, orderItemId: string): Promise<boolean> {
  const found = await tx.review.findUnique({ where: { orderItemId }, select: { id: true } });
  return found !== null;
}

const REVIEW_SELECT = {
  id: true,
  rating: true,
  comment: true,
  createdAt: true,
} as const satisfies Prisma.ReviewSelect;

export type CreatedReviewRow = Prisma.ReviewGetPayload<{ select: typeof REVIEW_SELECT }>;

/** Inserts the review. `productId` and `userId` are the locked item's and the session's. */
export async function insertReview(
  tx: DbTransaction,
  data: {
    orderItemId: string;
    productId: string;
    userId: string;
    rating: number;
    comment: string | null;
  },
): Promise<CreatedReviewRow> {
  return tx.review.create({ data, select: REVIEW_SELECT });
}
