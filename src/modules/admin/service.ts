/**
 * Admin service (docs/API_CONTRACTS.md section 5.9; REQ-A-01 to REQ-A-10, BR-17, BR-19 to BR-21,
 * BR-23, BR-26 to BR-28, BR-33, BR-36, BR-39, BR-40).
 *
 * Every function takes the acting user as `actor` (CLAUDE.md rule 2) and calls
 * `requireRole(actor, "ADMIN")` first, before any query: a customer or a seller is 403 FORBIDDEN
 * here even when a route handler forgot its own check (TM-07). The acting admin's id is the
 * session's and is the `actorId` of every audit row; nothing of a request names it.
 *
 * Every mutation writes one `AuditLog` row in the same transaction as its change, and a refused
 * mutation writes none (REQ-A-10; repository.ts). The application decisions are the sellers
 * module's services (T-040), which check the role and write their audit row themselves.
 *
 * No function here changes a user's role (BR-26), and none has a switch that turns product
 * approval off (BR-17).
 */
import {
  type ApplicationDecisionDto,
  approveApplication as approveApplicationAsAdmin,
  rejectApplication as rejectApplicationAsAdmin,
  type RejectApplicationBody,
} from "@/modules/sellers";
import { isFulfilmentTransitionAllowed } from "@/modules/orders";
import { type Actor, requireRole } from "@/server/auth/actor";
import { invalidStateTransition } from "@/server/errors";

import {
  adminNotFound,
  categoryHasProducts,
  lastAdmin,
  selfDeactivation,
  staleRevision,
} from "./errors";
import {
  toAdminApplicationDto,
  toAdminCategoryDto,
  toAdminOrderDto,
  toAdminProductDto,
  toAdminReviewDto,
  toAdminStoreDto,
  toAdminSummaryDto,
  toAdminUserDto,
  toAuditLogDto,
  toReportDto,
  toSettingsDto,
} from "./mapping";
import * as repo from "./repository";
import {
  type AdminApplicationDto,
  type AdminCategoryDto,
  type AdminOrderDto,
  type AdminProductDto,
  type AdminReviewDto,
  type AdminSellerOrderStatusBody,
  type AdminStoreDto,
  type AdminSummaryDto,
  type AdminUserDto,
  type ApproveProductBody,
  type AuditLogDto,
  CATEGORY_SORT_ORDER_MAX,
  type CreateCategoryBody,
  type ListApplicationsQuery,
  type ListAuditLogsQuery,
  type ListCategoriesQuery,
  type ListOrdersQuery,
  type ListProductsQuery,
  type ListReviewsQuery,
  type ListStoresQuery,
  type ListUsersQuery,
  type Page,
  type ProductReasonBody,
  type ReportDto,
  type ReportQuery,
  type ReviewModerationBody,
  type SettingsDto,
  type StoreReasonBody,
  type UpdateCategoryBody,
  type UpdateSettingsBody,
} from "./schema";
import { judgeModerationDecision, type ModerationDecision } from "./state";
import { retryTransientConflict } from "./transient-retry";

/** 403 FORBIDDEN unless the actor is an admin; returns the admin's id. */
function adminId(actor: Actor): string {
  requireRole(actor, "ADMIN");
  return actor.userId;
}

function pageOf<R, D>(
  result: repo.PageRows<R>,
  query: { page: number; pageSize: number },
  map: (row: R) => D,
): Page<D> {
  return {
    items: result.rows.map(map),
    page: query.page,
    pageSize: query.pageSize,
    total: result.total,
  };
}

// ---------------------------------------------------------------------------------------------
// Users (REQ-A-02)
// ---------------------------------------------------------------------------------------------

/** GET /admin/users: paginated, newest first; `q` matches name or email. */
export async function listUsers(actor: Actor, query: ListUsersQuery): Promise<Page<AdminUserDto>> {
  adminId(actor);
  const filter: repo.UserFilter = {};
  if (query.q !== undefined) filter.q = query.q;
  if (query.role !== undefined) filter.role = query.role;
  if (query.isActive !== undefined) filter.isActive = query.isActive;
  return pageOf(await repo.listUsers(filter, query), query, toAdminUserDto);
}

function activated(outcome: repo.ActivationOutcome): AdminUserDto {
  switch (outcome.kind) {
    case "done":
      return toAdminUserDto(outcome.row);
    case "not-found":
      throw adminNotFound();
    case "self":
      throw selfDeactivation();
    case "invalid-state":
      throw invalidStateTransition();
    case "last-admin":
      throw lastAdmin();
  }
}

/**
 * POST /admin/users/{id}/deactivate: every session of the user deleted in the same transaction.
 * Unknown: 404. Own account: 409 SELF_DEACTIVATION. Already inactive: 409
 * INVALID_STATE_TRANSITION. The last active admin: 409 LAST_ADMIN. No order or store changes
 * (BR-27).
 */
export async function deactivateUser(actor: Actor, userId: string): Promise<AdminUserDto> {
  return activated(await repo.deactivateUser(userId, adminId(actor)));
}

/** POST /admin/users/{id}/reactivate. Unknown: 404. Already active: 409 INVALID_STATE_TRANSITION. */
export async function reactivateUser(actor: Actor, userId: string): Promise<AdminUserDto> {
  return activated(await repo.reactivateUser(userId, adminId(actor)));
}

// ---------------------------------------------------------------------------------------------
// Applications and stores (REQ-A-03, REQ-A-04)
// ---------------------------------------------------------------------------------------------

/** GET /admin/applications: paginated, oldest first, filter `status`. */
export async function listApplications(
  actor: Actor,
  query: ListApplicationsQuery,
): Promise<Page<AdminApplicationDto>> {
  adminId(actor);
  const filter = query.status === undefined ? {} : { status: query.status };
  return pageOf(await repo.listApplications(filter, query), query, toAdminApplicationDto);
}

/**
 * POST /admin/applications/{id}/approve: the sellers module's decision (T-040). The decision is
 * one transaction that starts with the acting-admin check; when PostgreSQL aborts it for a
 * deadlock it is run again as a whole (SEC-096 remediation (b); transient-retry.ts).
 */
export async function approveApplication(
  actor: Actor,
  applicationId: string,
): Promise<ApplicationDecisionDto> {
  adminId(actor);
  return retryTransientConflict(() => approveApplicationAsAdmin(actor, applicationId));
}

/** POST /admin/applications/{id}/reject: the sellers module's decision (T-040), retried as above. */
export async function rejectApplication(
  actor: Actor,
  applicationId: string,
  body: RejectApplicationBody,
): Promise<ApplicationDecisionDto> {
  adminId(actor);
  return retryTransientConflict(() => rejectApplicationAsAdmin(actor, applicationId, body));
}

/** GET /admin/stores: paginated, newest first, hidden stores included. */
export async function listStores(
  actor: Actor,
  query: ListStoresQuery,
): Promise<Page<AdminStoreDto>> {
  adminId(actor);
  const filter: { status?: ListStoresQuery["status"]; q?: string } = {};
  if (query.status !== undefined) filter.status = query.status;
  if (query.q !== undefined) filter.q = query.q;
  return pageOf(await repo.listStores(filter, query), query, toAdminStoreDto);
}

function storeMoved(outcome: repo.StoreMoveOutcome): AdminStoreDto {
  switch (outcome.kind) {
    case "done":
      return toAdminStoreDto(outcome.row);
    case "not-found":
      throw adminNotFound();
    case "invalid-state":
      throw invalidStateTransition();
  }
}

/** POST /admin/stores/{id}/suspend: `APPROVED` to `SUSPENDED` with a reason (BR-14). */
export async function suspendStore(
  actor: Actor,
  storeId: string,
  body: StoreReasonBody,
): Promise<AdminStoreDto> {
  return storeMoved(await repo.moveStoreStatus(storeId, "SUSPENDED", body.reason, adminId(actor)));
}

/** POST /admin/stores/{id}/reinstate: `SUSPENDED` to `APPROVED` with a reason. */
export async function reinstateStore(
  actor: Actor,
  storeId: string,
  body: StoreReasonBody,
): Promise<AdminStoreDto> {
  return storeMoved(await repo.moveStoreStatus(storeId, "APPROVED", body.reason, adminId(actor)));
}

// ---------------------------------------------------------------------------------------------
// Product moderation (REQ-A-05; BR-17, BR-19, BR-36)
// ---------------------------------------------------------------------------------------------

/** GET /admin/products: `queue=true` is the approval queue, oldest submission first (BR-36). */
export async function listProducts(
  actor: Actor,
  query: ListProductsQuery,
): Promise<Page<AdminProductDto>> {
  adminId(actor);
  const filter: repo.ProductFilter = {};
  if (query.queue === true) filter.queue = true;
  if (query.moderationStatus !== undefined) filter.moderationStatus = query.moderationStatus;
  if (query.status !== undefined) filter.status = query.status;
  if (query.storeId !== undefined) filter.storeId = query.storeId;
  if (query.q !== undefined) filter.q = query.q;
  return pageOf(await repo.listProducts(filter, query), query, toAdminProductDto);
}

/** GET /admin/products/{id}: any product, whatever its state. Unknown: 404. */
export async function getProduct(actor: Actor, productId: string): Promise<AdminProductDto> {
  adminId(actor);
  const row = await repo.findProduct(productId);
  if (row === null) throw adminNotFound();
  return toAdminProductDto(row);
}

async function decide(
  actor: Actor,
  productId: string,
  decision: ModerationDecision,
  seenRevision: number,
  reason: string | null,
): Promise<AdminProductDto> {
  const outcome = await repo.decideProduct(
    productId,
    decision,
    seenRevision,
    reason,
    adminId(actor),
    (current) => judgeModerationDecision(decision, current, seenRevision),
  );
  switch (outcome.kind) {
    case "done":
      return toAdminProductDto(outcome.row);
    case "not-found":
      throw adminNotFound();
    case "stale-revision":
      throw staleRevision();
    case "invalid-state":
      throw invalidStateTransition();
  }
}

/**
 * POST /admin/products/{id}/approve: `PENDING` and `PUBLISHED` to `APPROVED`, clears the note.
 * Unknown: 404. Another revision: 409 STALE_REVISION. Not in the queue: 409
 * INVALID_STATE_TRANSITION (BR-36).
 */
export async function approveProduct(
  actor: Actor,
  productId: string,
  body: ApproveProductBody,
): Promise<AdminProductDto> {
  return decide(actor, productId, "approve", body.contentRevision, null);
}

/** POST /admin/products/{id}/reject: `PENDING` and `PUBLISHED` to `REJECTED`, with the reason. */
export async function rejectProduct(
  actor: Actor,
  productId: string,
  body: ProductReasonBody,
): Promise<AdminProductDto> {
  return decide(actor, productId, "reject", body.contentRevision, body.reason);
}

/** POST /admin/products/{id}/takedown: `APPROVED` to `TAKEN_DOWN`, with the reason. */
export async function takedownProduct(
  actor: Actor,
  productId: string,
  body: ProductReasonBody,
): Promise<AdminProductDto> {
  return decide(actor, productId, "takedown", body.contentRevision, body.reason);
}

// ---------------------------------------------------------------------------------------------
// Categories (REQ-A-06; BR-23)
// ---------------------------------------------------------------------------------------------

/** GET /admin/categories: paginated, by `sortOrder`, inactive ones included. */
export async function listCategories(
  actor: Actor,
  query: ListCategoriesQuery,
): Promise<Page<AdminCategoryDto>> {
  adminId(actor);
  return pageOf(await repo.listCategories(query), query, toAdminCategoryDto);
}

/** POST /admin/categories: the slug is generated; the category starts active. */
export async function createCategory(
  actor: Actor,
  body: CreateCategoryBody,
): Promise<AdminCategoryDto> {
  const input: { name: string; sortOrder?: number } = { name: body.name };
  if (body.sortOrder !== undefined) input.sortOrder = body.sortOrder;
  return toAdminCategoryDto(
    await repo.createCategory(input, adminId(actor), CATEGORY_SORT_ORDER_MAX),
  );
}

/**
 * PATCH /admin/categories/{id}: rename, reorder, switch on or off. A rename keeps the slug.
 * Switching off hides the category's products everywhere by the visibility rule; switching on
 * brings them back by themselves (BR-23). Unknown: 404.
 */
export async function updateCategory(
  actor: Actor,
  categoryId: string,
  body: UpdateCategoryBody,
): Promise<AdminCategoryDto> {
  const change: { name?: string; sortOrder?: number; isActive?: boolean } = {};
  if (body.name !== undefined) change.name = body.name;
  if (body.sortOrder !== undefined) change.sortOrder = body.sortOrder;
  if (body.isActive !== undefined) change.isActive = body.isActive;
  const outcome = await repo.updateCategory(categoryId, change, adminId(actor));
  switch (outcome.kind) {
    case "done":
      return toAdminCategoryDto(outcome.row);
    case "not-found":
      throw adminNotFound();
  }
}

/** DELETE /admin/categories/{id}: only when no product references it. Unknown: 404. */
export async function deleteCategory(
  actor: Actor,
  categoryId: string,
): Promise<{ outcome: "DELETED" }> {
  const outcome = await repo.deleteCategory(categoryId, adminId(actor));
  switch (outcome.kind) {
    case "deleted":
      return { outcome: "DELETED" };
    case "not-found":
      throw adminNotFound();
    case "has-products":
      throw categoryHasProducts();
  }
}

// ---------------------------------------------------------------------------------------------
// Orders (REQ-A-07; BR-20, BR-21, BR-27, BR-29, BR-39, BR-40)
// ---------------------------------------------------------------------------------------------

/** GET /admin/orders: paginated, newest first; the paid-date filter of BR-40. */
export async function listOrders(
  actor: Actor,
  query: ListOrdersQuery,
): Promise<Page<AdminOrderDto>> {
  adminId(actor);
  const filter: repo.OrderFilter = {};
  if (query.paymentStatus !== undefined) filter.paymentStatus = query.paymentStatus;
  if (query.fulfilmentStatus !== undefined) filter.fulfilmentStatus = query.fulfilmentStatus;
  if (query.storeId !== undefined) filter.storeId = query.storeId;
  if (query.userId !== undefined) filter.userId = query.userId;
  if (query.orderNumber !== undefined) filter.orderNumber = query.orderNumber;
  if (query.from !== undefined) filter.from = query.from;
  if (query.to !== undefined) filter.to = query.to;
  if (query.paidFrom !== undefined) filter.paidFrom = query.paidFrom;
  if (query.paidTo !== undefined) filter.paidTo = query.paidTo;
  return pageOf(await repo.listOrders(filter, query), query, toAdminOrderDto);
}

/** GET /admin/orders/{id}: the whole order with every seller order. Unknown: 404. */
export async function getOrder(actor: Actor, orderId: string): Promise<AdminOrderDto> {
  adminId(actor);
  const row = await repo.findOrder(orderId);
  if (row === null) throw adminNotFound();
  return toAdminOrderDto(row);
}

/**
 * Whether an admin may make this move now: the table of src/modules/orders/state.ts for the actor
 * `ADMIN`, and never on a seller order of a failed order (BR-20 point 6). Pure; exported for the
 * unit test.
 */
export function adminMayMove(
  current: {
    fulfilmentStatus: Parameters<typeof isFulfilmentTransitionAllowed>[0];
    paymentStatus: string;
  },
  to: AdminSellerOrderStatusBody["to"],
): boolean {
  if (current.paymentStatus === "FAILED") return false;
  return isFulfilmentTransitionAllowed(current.fulfilmentStatus, to, "ADMIN");
}

/**
 * POST /admin/seller-orders/{id}/status: `CANCELLED` (from `PENDING` or `PROCESSING`, paid or
 * not; stock restored once; the payment stays as it is, BR-21) or `DELIVERED` (from `SHIPPED`).
 * Anything else, and any move on a failed order's part, is 409 INVALID_STATE_TRANSITION (BR-20,
 * BR-29). Unknown: 404. Answers the whole order after the change.
 */
export async function changeSellerOrderStatus(
  actor: Actor,
  sellerOrderId: string,
  body: AdminSellerOrderStatusBody,
): Promise<AdminOrderDto> {
  const outcome = await repo.moveSellerOrderAsAdmin(
    sellerOrderId,
    body.to,
    adminId(actor),
    (current) => adminMayMove(current, body.to),
  );
  switch (outcome.kind) {
    case "not-found":
      throw adminNotFound();
    case "invalid-state":
      throw invalidStateTransition();
    case "done": {
      const row = await repo.findOrder(outcome.orderId);
      if (row === null) throw new Error("admin: an order changed in this request is gone.");
      return toAdminOrderDto(row);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Settings (REQ-A-09; BR-17, BR-28)
// ---------------------------------------------------------------------------------------------

/** GET /admin/settings: the single settings row. */
export async function getSettings(actor: Actor): Promise<SettingsDto> {
  adminId(actor);
  return toSettingsDto(await repo.readSettings());
}

/** PATCH /admin/settings: one or both of the two settings, within BR-28 (the schema). */
export async function updateSettings(actor: Actor, body: UpdateSettingsBody): Promise<SettingsDto> {
  const change: { flatShippingFeeSatang?: number; commissionRateBps?: number } = {};
  if (body.flatShippingFeeSatang !== undefined) {
    change.flatShippingFeeSatang = body.flatShippingFeeSatang;
  }
  if (body.commissionRateBps !== undefined) change.commissionRateBps = body.commissionRateBps;
  return toSettingsDto(await repo.updateSettings(change, adminId(actor)));
}

// ---------------------------------------------------------------------------------------------
// Summary, reports, audit log (REQ-A-01, REQ-A-08, REQ-A-10)
// ---------------------------------------------------------------------------------------------

/** GET /admin/summary: the four groups of D-028, over all time, from real rows. */
export async function getSummary(actor: Actor): Promise<AdminSummaryDto> {
  adminId(actor);
  return toAdminSummaryDto(await repo.readSummaryRows());
}

/** GET /admin/reports: orders and revenue by paid time, new users and sellers, over `[from, to)`. */
export async function getReport(actor: Actor, query: ReportQuery): Promise<ReportDto> {
  adminId(actor);
  return toReportDto(query.from, query.to, await repo.readReportRows(query.from, query.to));
}

// ---------------------------------------------------------------------------------------------
// Review moderation (SECURITY.md SEC-092; DATA_MODEL.md section 6.15)
// ---------------------------------------------------------------------------------------------

/** GET /admin/reviews: paginated, newest first, hidden reviews included unless filtered out. */
export async function listReviews(
  actor: Actor,
  query: ListReviewsQuery,
): Promise<Page<AdminReviewDto>> {
  adminId(actor);
  const filter: repo.ReviewFilter = {};
  if (query.productId !== undefined) filter.productId = query.productId;
  if (query.hidden !== undefined) filter.hidden = query.hidden;
  return pageOf(await repo.listReviews(filter, query), query, toAdminReviewDto);
}

function reviewMoved(outcome: repo.ReviewVisibilityOutcome): AdminReviewDto {
  switch (outcome.kind) {
    case "done":
      return toAdminReviewDto(outcome.row);
    case "not-found":
      throw adminNotFound();
    case "invalid-state":
      throw invalidStateTransition();
  }
}

/**
 * POST /admin/reviews/{id}/hide: the review leaves the product's public list and its rating
 * summary; nothing is deleted. Unknown: 404. Already hidden: 409 INVALID_STATE_TRANSITION.
 */
export async function hideReview(
  actor: Actor,
  reviewId: string,
  body: ReviewModerationBody,
): Promise<AdminReviewDto> {
  const admin = adminId(actor);
  return reviewMoved(await repo.moveReviewVisibility(reviewId, "hide", body.reason ?? null, admin));
}

/**
 * POST /admin/reviews/{id}/unhide: the review is public again, the hide fields cleared; who hid it
 * stays in the audit log. Unknown: 404. Not hidden: 409 INVALID_STATE_TRANSITION.
 */
export async function unhideReview(
  actor: Actor,
  reviewId: string,
  body: ReviewModerationBody,
): Promise<AdminReviewDto> {
  const admin = adminId(actor);
  return reviewMoved(
    await repo.moveReviewVisibility(reviewId, "unhide", body.reason ?? null, admin),
  );
}

/** GET /admin/audit-logs: paginated, newest first. Read-only: nothing edits or deletes an entry. */
export async function listAuditLogs(
  actor: Actor,
  query: ListAuditLogsQuery,
): Promise<Page<AuditLogDto>> {
  adminId(actor);
  const filter: repo.AuditFilter = {};
  if (query.actorId !== undefined) filter.actorId = query.actorId;
  if (query.action !== undefined) filter.action = query.action;
  if (query.targetType !== undefined) filter.targetType = query.targetType;
  if (query.targetId !== undefined) filter.targetId = query.targetId;
  if (query.from !== undefined) filter.from = query.from;
  if (query.to !== undefined) filter.to = query.to;
  return pageOf(await repo.listAuditLogs(filter, query), query, toAuditLogDto);
}
