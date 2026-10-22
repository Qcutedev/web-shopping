/**
 * Cart errors (docs/API_CONTRACTS.md sections 2.3, 5.4, 5.5.3).
 *
 * - A cart line id the acting user does not own is answered exactly like an id that does not
 *   exist: `404 NOT_FOUND`, the default message, `details` `{}` (section 1.8; D-015). The id is
 *   in the path, so no `details.resource` is given.
 * - A `productId` in the body that does not exist or is not visible is `404 NOT_FOUND` with
 *   `details.resource` `"product"` (section 1.8: a 404 caused by an id in the body names the kind
 *   of thing). A hidden product is answered exactly like a missing one.
 * - The refusals that name a line use the `details.items` shape of section 5.5.3, one entry.
 * - An add that would take a line above 99 is `400 VALIDATION_ERROR` on the field `quantity`
 *   (REQ-C-10; BR-03), reported like a schema refusal of the same field.
 * - An add that would create a line in a cart already at MAX_CART_LINES is `409 CONFLICT` with
 *   `details.reason` `CART_LINE_LIMIT` (SEC-053).
 */
import {
  type AppError,
  conflict,
  insufficientStock,
  notFound,
  productUnavailable,
  validationError,
} from "@/server/errors";

import { CART_LINE_LIMIT_REASON, MAX_LINE_QUANTITY, type RefusedLineDetail } from "./schema";

export function cartLineNotFound(): AppError {
  return notFound();
}

export function productNotFound(): AppError {
  return notFound({ details: { resource: "product" } });
}

/** BR-16: the product belongs to the caller's own store. No line is created or changed. */
export function ownStoreProduct(input: {
  cartItemId: string | null;
  productId: string;
  requestedQuantity: number;
}): AppError {
  const item: RefusedLineDetail = {
    cartItemId: input.cartItemId,
    productId: input.productId,
    reason: "OWN_STORE",
    requestedQuantity: input.requestedQuantity,
    availableStock: null,
  };
  return productUnavailable({ details: { items: [item] } });
}

/**
 * BR-38: a quantity change on the caller's own line whose product is not visible. Says no more
 * than the cart read says: not which condition hides the product, not its stock or price.
 */
export function hiddenLineQuantityChange(input: {
  cartItemId: string;
  productId: string;
  requestedQuantity: number;
}): AppError {
  const item: RefusedLineDetail = {
    cartItemId: input.cartItemId,
    productId: input.productId,
    reason: "NOT_AVAILABLE",
    requestedQuantity: input.requestedQuantity,
    availableStock: null,
  };
  return productUnavailable({ details: { items: [item] } });
}

/** BR-31 (1), BR-38: the product is visible and sold out. No line is created or changed. */
export function soldOut(input: {
  cartItemId: string | null;
  productId: string;
  requestedQuantity: number;
}): AppError {
  const item: RefusedLineDetail = {
    cartItemId: input.cartItemId,
    productId: input.productId,
    reason: "INSUFFICIENT_STOCK",
    requestedQuantity: input.requestedQuantity,
    availableStock: 0,
  };
  return insufficientStock([item]);
}

/**
 * SEC-053: an add that would create a line in a cart that already holds MAX_CART_LINES lines.
 * Nothing is created or changed. `409 CONFLICT` with `details.reason` `CART_LINE_LIMIT` only.
 */
export function cartLineLimitReached(): AppError {
  return conflict(CART_LINE_LIMIT_REASON);
}

/** BR-03, BR-31 (3): an add that would take the line above 99. The line is unchanged. */
export function lineQuantityTooBig(): AppError {
  return validationError([
    {
      path: "quantity",
      code: "too_big",
      message: `The line's quantity would exceed ${MAX_LINE_QUANTITY}.`,
    },
  ]);
}
