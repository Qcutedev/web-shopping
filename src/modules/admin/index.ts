/**
 * Public surface of the admin module (T-050; docs/API_CONTRACTS.md section 5.9). Route handlers
 * and pages import from here only.
 */
export {
  adminMayMove,
  approveApplication,
  approveProduct,
  changeSellerOrderStatus,
  createCategory,
  deactivateUser,
  deleteCategory,
  getOrder,
  getProduct,
  getReport,
  getSettings,
  getSummary,
  hideReview,
  listApplications,
  listAuditLogs,
  listCategories,
  listOrders,
  listProducts,
  listReviews,
  listStores,
  listUsers,
  reactivateUser,
  rejectApplication,
  rejectProduct,
  reinstateStore,
  suspendStore,
  takedownProduct,
  unhideReview,
  updateCategory,
  updateSettings,
} from "./service";
export * from "./schema";
export {
  judgeModerationDecision,
  MODERATION_DECISION_RULES,
  type ModerationDecision,
  REVIEW_VISIBILITY_TRANSITIONS,
  type ReviewVisibility,
} from "./state";
export { CATEGORY_HAS_PRODUCTS, LAST_ADMIN, SELF_DEACTIVATION, STALE_REVISION } from "./errors";
export { applicationIdParamsSchema, rejectApplicationBodySchema } from "@/modules/sellers";
export { queryRecord } from "@/modules/catalog/schema";
