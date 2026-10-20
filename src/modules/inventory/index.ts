/**
 * Public surface of the seller product and inventory module (T-042; docs/API_CONTRACTS.md section
 * 5.7.2). Route handlers and pages import from here only.
 */
export {
  archiveProduct,
  changeProductStatus,
  changeStock,
  createProduct,
  deleteProduct,
  getOwnProduct,
  isLowStock,
  isOnSale,
  isSoldOutForSeller,
  listOwnProducts,
  nextStock,
  PRODUCT_SLUG_ATTEMPTS,
  publishProduct,
  unpublishProduct,
  updateProduct,
} from "./service";
export * from "./schema";
export {
  assertProductTransition,
  classifySave,
  type ModerationView,
  PRODUCT_TRANSITIONS,
  type ProductAction,
  productActionSourceStates,
  type ProductTransition,
  productTransitionTarget,
  type SaveEffect,
} from "./state";
export {
  CATEGORY_INACTIVE,
  DUPLICATE_SKU,
  NEGATIVE_STOCK,
  PRODUCT_LIMIT,
  SLUG_TAKEN,
  STOCK_LIMIT,
  UPLOAD_IN_USE,
} from "./errors";
