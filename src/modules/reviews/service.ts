/**
 * Reviews service (docs/API_CONTRACTS.md section 5.6; REQ-C-14, BR-11).
 *
 * `createReview` takes the acting user as `actor` (CLAUDE.md rule 2). The access level is `user`:
 * any role may have bought something. Ownership is the control: the order item is looked up only
 * through the actor's own order, so another user's order or item is 404 exactly like a missing one
 * (section 1.8, D-015). The product and the reviewer are copied from the order item and the
 * session, never from the request (DATA_MODEL.md section 6.15).
 *
 * One transaction (CLAUDE.md rule 5): the item is locked, BR-11 is judged on the locked row
 * (eligibility.ts), and the review is inserted. A concurrent second review of the same item waits
 * for the lock and is then refused with `DUPLICATE_REVIEW`; should one ever pass that check, the
 * unique index refuses its insert and the answer is the same.
 */
import type { Actor } from "@/server/auth/actor";
import { db, isUniqueIndexViolation } from "@/server/db";

import { judgeReviewEligibility } from "./eligibility";
import { duplicateReview, notDelivered, reviewTargetNotFound } from "./errors";
import {
  type CreatedReviewRow,
  insertReview,
  lockOwnOrderItem,
  orderItemHasReview,
  REVIEW_ORDER_ITEM_INDEX,
  REVIEW_TRANSACTION_OPTIONS,
} from "./repository";
import type { CreateReviewBody, CreatedReviewDto, ReviewTargetParams } from "./schema";

export function toCreatedReviewDto(row: CreatedReviewRow): CreatedReviewDto {
  return {
    id: row.id,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
  };
}

/** POST /orders/{id}/items/{itemId}/review: 201 with the review, or 404 / 409 (section 5.6). */
export async function createReview(
  actor: Actor,
  target: ReviewTargetParams,
  body: CreateReviewBody,
): Promise<CreatedReviewDto> {
  try {
    const row = await db.$transaction(async (tx) => {
      const item = await lockOwnOrderItem(tx, actor.userId, target.id, target.itemId);
      if (item === null) throw reviewTargetNotFound();
      const eligibility = judgeReviewEligibility({
        fulfilmentStatus: item.fulfilmentStatus,
        hasReview: await orderItemHasReview(tx, item.id),
      });
      if (eligibility === "NOT_DELIVERED") throw notDelivered();
      if (eligibility === "DUPLICATE_REVIEW") throw duplicateReview();
      return insertReview(tx, {
        orderItemId: item.id,
        productId: item.productId,
        userId: actor.userId,
        rating: body.rating,
        comment: body.comment ?? null,
      });
    }, REVIEW_TRANSACTION_OPTIONS);
    return toCreatedReviewDto(row);
  } catch (error) {
    if (isUniqueIndexViolation(error, REVIEW_ORDER_ITEM_INDEX)) throw duplicateReview();
    throw error;
  }
}
