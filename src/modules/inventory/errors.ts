/**
 * Seller product and inventory errors (docs/API_CONTRACTS.md sections 2.3 and 5.7.2).
 *
 * - A product id that is unknown or of another store: `404 NOT_FOUND`, `details` `{}`, the same
 *   answer for both (section 1.8, D-015).
 * - A `categoryId` with no category: `404 NOT_FOUND` with `details.resource` `"category"`.
 * - A storage key in `imageKeys` that is not an upload of the caller's store, unknown and foreign
 *   alike: `404 NOT_FOUND` with `details.resource` `"upload"`.
 * - A store that is not `APPROVED` at the write: `403 SELLER_NOT_APPROVED` (DATA_MODEL.md 7.7).
 * - A status move the table does not allow, and any write to an `ARCHIVED` product:
 *   `409 INVALID_STATE_TRANSITION` (state.ts).
 * - `409 CONFLICT` with one of the reasons below.
 */
import { type AppError, conflict, notFound, sellerNotApproved } from "@/server/errors";

/** Another product of the store that is not archived has this SKU (`Product_storeId_sku_live_key`). */
export const DUPLICATE_SKU = "DUPLICATE_SKU";
/** A key in `imageKeys` is already a picture of another product (`ProductImage_uploadId_key`). */
export const UPLOAD_IN_USE = "UPLOAD_IN_USE";
/** A stock change whose result would be below zero. */
export const NEGATIVE_STOCK = "NEGATIVE_STOCK";
/** An increase whose result would be above 1,000,000 (BR-34). */
export const STOCK_LIMIT = "STOCK_LIMIT";
/** Creating a product in, or moving a product to, an inactive category (BR-23). */
export const CATEGORY_INACTIVE = "CATEGORY_INACTIVE";
/**
 * **Provisional (T-042), not yet in section 2.3:** the generated slug collided with an existing
 * product's slug on every attempt (`Product_slug_key`; DATA_MODEL.md section 9). With 40 random
 * bits per suffix this is all but impossible; it exists so that the violation never leaves as a
 * raw database error.
 */
export const SLUG_TAKEN = "SLUG_TAKEN";

export function productNotFound(): AppError {
  return notFound();
}

export function categoryNotFound(): AppError {
  return notFound({ details: { resource: "category" } });
}

export function uploadNotFound(): AppError {
  return notFound({ details: { resource: "upload" } });
}

export function storeNotApproved(): AppError {
  return sellerNotApproved();
}

/** No cause is attached: a database error's `meta` holds the conflicting value (21.5). */
export function duplicateSku(): AppError {
  return conflict(DUPLICATE_SKU);
}

export function uploadInUse(): AppError {
  return conflict(UPLOAD_IN_USE);
}

export function negativeStock(): AppError {
  return conflict(NEGATIVE_STOCK);
}

export function stockLimit(): AppError {
  return conflict(STOCK_LIMIT);
}

export function categoryInactive(): AppError {
  return conflict(CATEGORY_INACTIVE);
}

export function slugTaken(): AppError {
  return conflict(SLUG_TAKEN);
}
