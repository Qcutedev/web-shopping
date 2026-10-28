/**
 * Orders errors (docs/API_CONTRACTS.md sections 1.8 and 5.5).
 *
 * An order id the acting user does not own is answered exactly like an id that does not exist:
 * `404 NOT_FOUND`, the default message, `details` `{}` (D-015). The id is in the path, so no
 * `details.resource` is given.
 */
import { type AppError, conflict, notFound } from "@/server/errors";

export function orderNotFound(): AppError {
  return notFound();
}

/**
 * A seller order id that is unknown, of another store, or of an order whose payment is not `PAID`
 * (BR-35): the same `404 NOT_FOUND`, `details` `{}`, for all three (section 1.8, D-015).
 */
export function sellerOrderNotFound(): AppError {
  return notFound();
}

/** `details.reason` of a seller's `DELIVERED` sent too soon after `SHIPPED` (SEC-072). */
export const DELIVERY_TOO_EARLY = "DELIVERY_TOO_EARLY";

/**
 * 409 CONFLICT, reason `DELIVERY_TOO_EARLY`: a seller asked for `DELIVERED` before
 * `SELLER_DELIVERY_MIN_HOURS_AFTER_SHIPPED` hours had passed since the shipment's `shippedAt`, by
 * the database clock (SEC-072; docs/API_CONTRACTS.md sections 2.3 and 5.7.3). Nothing changes.
 */
export function deliveryTooEarly(): AppError {
  return conflict(DELIVERY_TOO_EARLY);
}
