/**
 * Admin contract (docs/API_CONTRACTS.md section 5.9; REQ-A-01 to REQ-A-10, REQ-N-06, BR-17,
 * BR-19 to BR-21, BR-23, BR-26 to BR-28, BR-33, BR-36, BR-39, BR-40): the Zod schemas of every
 * request input under `/api/v1/admin/**` and the types of every response shape. Authoritative for
 * those endpoints; the document must match them.
 *
 * Every mutation body is a strict object (section 1.1): an unknown key, `role`, `userId`,
 * `storeId`, `status`, `slug`, `isSample`, `moderationStatus`, `requireProductApproval`, or an
 * amount the endpoint does not list, is `400 VALIDATION_ERROR` and nothing changes. No body here
 * can change a role (BR-26). Unknown query parameters are not interpreted: the query schemas strip
 * them.
 *
 * Every list is paginated with `page` and `pageSize` (section 1.7; REQ-N-06): at most 50 rows.
 *
 * Times in a query are ISO 8601 instants with an explicit `Z` or offset (section 1.6); a value
 * without one, and a date without a time, is 400. A range is half-open (`from` inclusive, `to`
 * exclusive) and `from` must be earlier than `to`.
 *
 * Money is integer satang (section 1.5); aggregates can exceed 32 bits and are sent only as safe
 * integers. The commission rate is in basis points and a whole number of percent (BR-28).
 */
import { z } from "zod";

import { NAME_ALLOWED_TEXT } from "@/modules/auth/schema";
import type { ImageRef } from "@/modules/catalog/schema";
import { paginationQuerySchema } from "@/modules/catalog/schema";
import { MODERATION_STATUSES, PRODUCT_STATUSES, type SellerProductDto } from "@/modules/inventory";
import {
  FULFILMENT_STATUSES,
  type OrderDto,
  PAYMENT_STATUSES,
  type SellerOrderDto,
} from "@/modules/orders";
import {
  APPLICATION_STATUSES,
  type ApplicationStatusValue,
  reviewReasonSchema,
  STORE_STATUSES,
  type StoreStatusValue,
} from "@/modules/sellers";
import { ROLES, type Role } from "@/server/auth/actor";

export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type Page } from "@/modules/catalog/schema";

// ---------------------------------------------------------------------------------------------
// Limits and bounds
// ---------------------------------------------------------------------------------------------

/** Longest id accepted in a path or a query (section 1.4; the same bound as the other modules). */
export const MAX_ID_LENGTH = 200;
/** Longest search text (`q`), after surrounding white space is removed. */
export const MAX_SEARCH_TEXT_LENGTH = 100;
/** Longest `orderNumber` filter: an order number is at most 24 characters (section 1.4). */
export const MAX_ORDER_NUMBER_LENGTH = 24;
/** Category name (item 8.2-7, chosen in T-050). */
export const CATEGORY_NAME_MAX = 100;
/** Bounds of a category's `sortOrder` (chosen in T-050; the column has no CHECK). */
export const CATEGORY_SORT_ORDER_MIN = 0;
export const CATEGORY_SORT_ORDER_MAX = 1_000_000;
/** An admin's reason (suspension, reinstatement, rejection, takedown), as for applications. */
export { REVIEW_REASON_MAX } from "@/modules/sellers";
/** BR-28: the flat shipping fee, 0.00 to 1,000.00 THB inclusive. */
export const MIN_SHIPPING_FEE_SATANG = 0;
export const MAX_SHIPPING_FEE_SATANG = 100_000;
/** BR-28: the commission rate, 0 to 100 percent inclusive, whole percents only (D-026, OQ-38). */
export const MIN_COMMISSION_RATE_BPS = 0;
export const MAX_COMMISSION_RATE_BPS = 10_000;
export const COMMISSION_RATE_STEP_BPS = 100;
/** Largest `contentRevision` accepted in a body; the column is a 32-bit integer. */
export const MAX_CONTENT_REVISION = 2_147_483_647;
/** Audit filters: `action` and `targetType` are short upper-case or Pascal-case words. */
export const MAX_AUDIT_WORD_LENGTH = 64;

// ---------------------------------------------------------------------------------------------
// Field schemas
// ---------------------------------------------------------------------------------------------

const STORABLE_TEXT_MESSAGE = "Must not contain U+0000 or a lone surrogate.";
const DISPLAY_TEXT_MESSAGE =
  "Must contain a visible character and no control, format, or invisible character.";

function isStorableText(value: string): boolean {
  return !value.includes("\u0000") && value.isWellFormed();
}

/** An opaque id, form only (section 1.4). */
export const idSchema = z
  .string()
  .min(1)
  .max(MAX_ID_LENGTH)
  .refine(isStorableText, { error: STORABLE_TEXT_MESSAGE });

/** The `{id}` path parameter of every admin endpoint that names a row. */
export const idParamsSchema = z.object({ id: idSchema });
export type IdParams = z.infer<typeof idParamsSchema>;

/** A query value as `URLSearchParams` hands it over; a parameter given twice is a list (400). */
const queryString = z.string({ error: "Must be given at most once." });

const queryId = queryString.pipe(idSchema);

/** `q`: trimmed; blank is the same as absent; matched as plain text (`%`, `_`, `\` are text). */
const searchTextSchema = queryString
  .transform((text) => text.trim())
  .pipe(
    z.string().max(MAX_SEARCH_TEXT_LENGTH).refine(isStorableText, { error: STORABLE_TEXT_MESSAGE }),
  )
  .transform((text) => (text === "" ? undefined : text));

/** `true` or `false`, nothing else. */
const booleanParam = queryString
  .pipe(z.enum(["true", "false"]))
  .transform((value) => value === "true");

/** Only `true` is accepted (as for the seller's `lowStock` flag). */
const trueOnlyParam = queryString.pipe(z.literal("true")).transform(() => true as const);

/**
 * An instant with an explicit `Z` or offset (section 1.6), as a `Date`. A value without an offset,
 * a date without a time, and an impossible date are 400.
 */
export const instantSchema = z
  .string()
  .pipe(z.iso.datetime({ offset: true }))
  .transform((value) => new Date(value))
  .refine((date) => !Number.isNaN(date.getTime()), { error: "Must be a real point in time." });

const queryInstant = queryString.pipe(instantSchema);

/** An upper-case or Pascal-case word: the form of an audit `action` or `targetType`. */
const auditWord = queryString.pipe(
  z
    .string()
    .min(1)
    .max(MAX_AUDIT_WORD_LENGTH)
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/, { error: "Must be a word of letters, digits, and _." }),
);

function oneLineText(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(NAME_ALLOWED_TEXT, { error: DISPLAY_TEXT_MESSAGE });
}

function hasAnyKey(value: Record<string, unknown>): boolean {
  return Object.values(value).some((entry) => entry !== undefined);
}

/**
 * Adds a 400 at `to` unless `from` is earlier than `to`; both must be given for the check. The
 * object's refinement also runs when a field already failed (the field is then not a `Date`);
 * that case is left to the field's own issue.
 */
function rangeIssue(context: z.RefinementCtx, from: unknown, to: unknown, toPath: string): void {
  if (from instanceof Date && to instanceof Date && from.getTime() >= to.getTime()) {
    context.addIssue({ code: "custom", path: [toPath], message: "Must be later than the start." });
  }
}

// ---------------------------------------------------------------------------------------------
// 5.9.1 Users
// ---------------------------------------------------------------------------------------------

/** `q` (substring of name or email, case-insensitive), `role`, `isActive`. */
export const listUsersQuerySchema = paginationQuerySchema.extend({
  q: searchTextSchema.optional(),
  role: queryString.pipe(z.enum(ROLES)).optional(),
  isActive: booleanParam.optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export interface AdminUserStoreDto {
  id: string;
  name: string;
  slug: string;
  status: StoreStatusValue;
}

/**
 * A user as an admin sees it (section 5.9.1). Never a password hash, a session, or a session's
 * address or browser details.
 */
export interface AdminUserDto {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  isActive: boolean;
  createdAt: string;
  store: AdminUserStoreDto | null;
}

// ---------------------------------------------------------------------------------------------
// 5.9.2 Applications and stores
// ---------------------------------------------------------------------------------------------

export const listApplicationsQuerySchema = paginationQuerySchema.extend({
  status: queryString.pipe(z.enum(APPLICATION_STATUSES)).optional(),
});
export type ListApplicationsQuery = z.infer<typeof listApplicationsQuerySchema>;

/** An application as an admin sees it in the list (section 5.9.2). */
export interface AdminApplicationDto {
  id: string;
  applicant: { id: string; name: string; email: string; isActive: boolean };
  storeName: string;
  description: string;
  contactPhone: string;
  status: ApplicationStatusValue;
  /** The rejection reason; null unless `REJECTED`. */
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export const listStoresQuerySchema = paginationQuerySchema.extend({
  status: queryString.pipe(z.enum(STORE_STATUSES)).optional(),
  q: searchTextSchema.optional(),
});
export type ListStoresQuery = z.infer<typeof listStoresQuerySchema>;

/** Body of suspend and reinstate: a reason, required (REQ-A-04). */
export const storeReasonBodySchema = z.strictObject({ reason: reviewReasonSchema });
export type StoreReasonBody = z.infer<typeof storeReasonBodySchema>;

/** A store as an admin sees it (section 5.9.2); hidden stores included. */
export interface AdminStoreDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo: ImageRef | null;
  contactPhone: string;
  status: StoreStatusValue;
  statusReason: string | null;
  isSample: boolean;
  ownerId: string;
  ownerIsActive: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------------------------
// 5.9.3 Product moderation
// ---------------------------------------------------------------------------------------------

/**
 * `queue=true` is the approval queue (BR-36) and cannot be combined with `moderationStatus` or
 * `status` (400 at `queue`). Other filters: `storeId`, `q` (substring of the title).
 */
export const listProductsQuerySchema = paginationQuerySchema
  .extend({
    queue: trueOnlyParam.optional(),
    moderationStatus: queryString.pipe(z.enum(MODERATION_STATUSES)).optional(),
    status: queryString.pipe(z.enum(PRODUCT_STATUSES)).optional(),
    storeId: queryId.optional(),
    q: searchTextSchema.optional(),
  })
  .superRefine((query, context) => {
    if (
      query.queue === true &&
      (query.moderationStatus !== undefined || query.status !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["queue"],
        message: "queue=true cannot be combined with moderationStatus or status.",
      });
    }
  });
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

const contentRevisionSchema = z.number().int().min(1).max(MAX_CONTENT_REVISION);

/** `POST /admin/products/{id}/approve`: the revision the admin saw. */
export const approveProductBodySchema = z.strictObject({ contentRevision: contentRevisionSchema });
export type ApproveProductBody = z.infer<typeof approveProductBodySchema>;

/** `reject` and `takedown`: the revision the admin saw and a reason, required. */
export const productReasonBodySchema = z.strictObject({
  contentRevision: contentRevisionSchema,
  reason: reviewReasonSchema,
});
export type ProductReasonBody = z.infer<typeof productReasonBodySchema>;

/** The seller's view of a product plus what an admin decides with (section 5.9.3). */
export interface AdminProductDto extends SellerProductDto {
  contentRevision: number;
  /** When the product most recently entered the approval queue (BR-36). */
  moderationRequestedAt: string;
  store: AdminUserStoreDto;
}

// ---------------------------------------------------------------------------------------------
// 5.9.4 Categories
// ---------------------------------------------------------------------------------------------

export const listCategoriesQuerySchema = paginationQuerySchema;
export type ListCategoriesQuery = z.infer<typeof listCategoriesQuerySchema>;

export const categoryNameSchema = oneLineText(CATEGORY_NAME_MAX);
export const categorySortOrderSchema = z
  .number()
  .int()
  .min(CATEGORY_SORT_ORDER_MIN)
  .max(CATEGORY_SORT_ORDER_MAX);

/** `{ name, sortOrder? }`. Without `sortOrder` the category goes last (largest plus one). */
export const createCategoryBodySchema = z.strictObject({
  name: categoryNameSchema,
  sortOrder: categorySortOrderSchema.optional(),
});
export type CreateCategoryBody = z.infer<typeof createCategoryBodySchema>;

/** Any of `name`, `sortOrder`, `isActive`, at least one. A rename keeps the slug. */
export const updateCategoryBodySchema = z
  .strictObject({
    name: categoryNameSchema.optional(),
    sortOrder: categorySortOrderSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine(hasAnyKey, { error: "At least one field must be given." });
export type UpdateCategoryBody = z.infer<typeof updateCategoryBodySchema>;

export interface AdminCategoryDto {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------------------------
// 5.9.5 Orders
// ---------------------------------------------------------------------------------------------

/**
 * Filters: `paymentStatus`; `fulfilmentStatus` and `storeId` (an order with at least one seller
 * order that matches every one of the two given); `userId`; `orderNumber` (exact); `from` and `to`
 * on the creation time; `paidFrom` and `paidTo` on the paid time (BR-40). The paid range needs both
 * ends (REQUIREMENTS.md Q44 is open; a range with one end is 400 until the owner answers).
 */
export const listOrdersQuerySchema = paginationQuerySchema
  .extend({
    paymentStatus: queryString.pipe(z.enum(PAYMENT_STATUSES)).optional(),
    fulfilmentStatus: queryString.pipe(z.enum(FULFILMENT_STATUSES)).optional(),
    storeId: queryId.optional(),
    userId: queryId.optional(),
    orderNumber: queryString
      .pipe(
        z
          .string()
          .min(1)
          .max(MAX_ORDER_NUMBER_LENGTH)
          .regex(/^[A-Za-z0-9]+$/, { error: "Must be letters and digits only." }),
      )
      .optional(),
    from: queryInstant.optional(),
    to: queryInstant.optional(),
    paidFrom: queryInstant.optional(),
    paidTo: queryInstant.optional(),
  })
  .superRefine((query, context) => {
    rangeIssue(context, query.from, query.to, "to");
    if ((query.paidFrom === undefined) !== (query.paidTo === undefined)) {
      context.addIssue({
        code: "custom",
        path: [query.paidFrom === undefined ? "paidFrom" : "paidTo"],
        message: "paidFrom and paidTo must be given together.",
      });
    }
    rangeIssue(context, query.paidFrom, query.paidTo, "paidTo");
  });
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

/** The statuses an admin may ask for (section 5.9.5; the fulfilment table). */
export const ADMIN_TARGET_STATUSES = ["CANCELLED", "DELIVERED"] as const;
export type AdminTargetStatus = (typeof ADMIN_TARGET_STATUSES)[number];

export const adminSellerOrderStatusBodySchema = z.strictObject({
  to: z.enum(ADMIN_TARGET_STATUSES),
});
export type AdminSellerOrderStatusBody = z.infer<typeof adminSellerOrderStatusBodySchema>;

export interface AdminSellerOrderDto extends SellerOrderDto {
  storeId: string;
  /** Copied at purchase; recorded only (BR-13). */
  commissionRateBps: number;
}

/** The customer's order shape (section 5.5.2) plus `userId` and the per-store extras. */
export interface AdminOrderDto extends Omit<OrderDto, "sellerOrders"> {
  userId: string;
  sellerOrders: AdminSellerOrderDto[];
}

// ---------------------------------------------------------------------------------------------
// 5.9.6 Settings
// ---------------------------------------------------------------------------------------------

export const flatShippingFeeSatangSchema = z
  .number()
  .int()
  .min(MIN_SHIPPING_FEE_SATANG)
  .max(MAX_SHIPPING_FEE_SATANG);

export const commissionRateBpsSchema = z
  .number()
  .int()
  .min(MIN_COMMISSION_RATE_BPS)
  .max(MAX_COMMISSION_RATE_BPS)
  .multipleOf(COMMISSION_RATE_STEP_BPS, { error: "Must be a whole number of percent." });

/** One or both of the two settings; nothing else (no moderation switch, BR-17). */
export const updateSettingsBodySchema = z
  .strictObject({
    flatShippingFeeSatang: flatShippingFeeSatangSchema.optional(),
    commissionRateBps: commissionRateBpsSchema.optional(),
  })
  .refine(hasAnyKey, { error: "At least one field must be given." });
export type UpdateSettingsBody = z.infer<typeof updateSettingsBodySchema>;

export interface SettingsDto {
  flatShippingFeeSatang: number;
  commissionRateBps: number;
  updatedAt: string;
  /** The admin who last changed the settings, or null (the migration's row). */
  updatedById: string | null;
}

// ---------------------------------------------------------------------------------------------
// 5.9.7 Summary, reports, audit log
// ---------------------------------------------------------------------------------------------

/** `GET /admin/reports`: both ends required, `from` earlier than `to`. */
export const reportQuerySchema = z
  .object({ from: queryInstant, to: queryInstant })
  .superRefine((query, context) => rangeIssue(context, query.from, query.to, "to"));
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export interface AdminSummaryDto {
  pendingApplicationCount: number;
  /** The size of the approval queue (BR-36). */
  pendingProductCount: number;
  /** All users, one total (D-033 point 5). */
  userCount: number;
  storesByStatus: Record<StoreStatusValue, number>;
  /** Over all time: paid orders with at least one part not cancelled (BR-33). */
  orderCount: number;
  /** Aggregate (section 1.5): goods only, paid and not cancelled, over all time (BR-33). */
  paidRevenueSatang: number;
}

export interface ReportDto {
  from: string;
  to: string;
  orderCount: number;
  /** Aggregate (section 1.5). */
  paidRevenueSatang: number;
  newUserCount: number;
  newSellerCount: number;
}

export const listAuditLogsQuerySchema = paginationQuerySchema
  .extend({
    actorId: queryId.optional(),
    action: auditWord.optional(),
    targetType: auditWord.optional(),
    targetId: queryId.optional(),
    from: queryInstant.optional(),
    to: queryInstant.optional(),
  })
  .superRefine((query, context) => rangeIssue(context, query.from, query.to, "to"));
export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;

/** JSON as stored in `AuditLog.metadata`. */
export type AuditMetadata =
  string | number | boolean | null | AuditMetadata[] | { [key: string]: AuditMetadata };

export interface AuditLogDto {
  id: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: AuditMetadata;
  createdAt: string;
}

// ---------------------------------------------------------------------------------------------
// 5.9.9 Review moderation (SECURITY.md SEC-092; DATA_MODEL.md section 6.15)
// ---------------------------------------------------------------------------------------------

/**
 * `GET /admin/reviews`: newest first, hidden reviews included. Filters: `productId`, `hidden`
 * (`true` only hidden, `false` only public).
 */
export const listReviewsQuerySchema = paginationQuerySchema.extend({
  productId: queryId.optional(),
  hidden: booleanParam.optional(),
});
export type ListReviewsQuery = z.infer<typeof listReviewsQuerySchema>;

/**
 * Body of `hide` and `unhide`: an optional reason, the admin reason rule (1 to 500 characters
 * after normalisation; blank is 400). Absent and `null` both mean "no reason". A hide stores it in
 * `Review.hiddenReason` and the audit row; an un-hide writes it to the audit row only.
 */
export const reviewModerationBodySchema = z.strictObject({
  reason: reviewReasonSchema.nullable().optional(),
});
export type ReviewModerationBody = z.infer<typeof reviewModerationBodySchema>;

/**
 * A review as an admin sees it (section 5.9.9): the customer's text as stored, the product it is
 * on, the author, and the hide fields. `hiddenAt`, `hiddenByUserId`, and `hiddenReason` are all
 * null while the review is public.
 */
export interface AdminReviewDto {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  product: { id: string; title: string; slug: string };
  author: { id: string; name: string };
  hiddenAt: string | null;
  hiddenByUserId: string | null;
  hiddenReason: string | null;
}
