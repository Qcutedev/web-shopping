/**
 * Checkout errors (docs/API_CONTRACTS.md sections 2.3, 5.5.1, 5.5.3).
 *
 * - An `addressId` the acting user does not own is answered exactly like one that does not exist:
 *   `404 NOT_FOUND` with `details.resource` `"address"` (section 1.8: a 404 caused by an id in the
 *   body names the kind of thing, never whether it exists).
 * - No cart, or a cart with no lines: `409 CART_EMPTY`, `details` `{}`.
 * - A cart with a line that cannot be bought: `409 INSUFFICIENT_STOCK` when every listed line
 *   fails on stock only, else `409 PRODUCT_UNAVAILABLE`; both with `details.items` (every such
 *   line) and `details.totals` (section 5.5.3).
 * - A grand total above BR-04: `422 ORDER_LIMIT_EXCEEDED`, `details` `{}`.
 */
import { AppError, cartEmpty, notFound, orderLimitExceeded } from "@/server/errors";

import { refusalCode } from "./pricing";
import type { RefusedCheckoutTotals, RefusedLineDetail } from "./schema";

export function addressNotFound(): AppError {
  return notFound({ details: { resource: "address" } });
}

export function emptyCart(): AppError {
  return cartEmpty();
}

export function totalAboveLimit(): AppError {
  return orderLimitExceeded();
}

export function checkoutRefused(
  items: readonly RefusedLineDetail[],
  totals: RefusedCheckoutTotals,
): AppError {
  if (items.length === 0) throw new Error("checkoutRefused: a refusal names at least one line.");
  return new AppError(refusalCode(items), { details: { items: [...items], totals } });
}
