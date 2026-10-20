/**
 * Orders errors (docs/API_CONTRACTS.md sections 1.8 and 5.5).
 *
 * An order id the acting user does not own is answered exactly like an id that does not exist:
 * `404 NOT_FOUND`, the default message, `details` `{}` (D-015). The id is in the path, so no
 * `details.resource` is given.
 */
import { type AppError, notFound } from "@/server/errors";

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
