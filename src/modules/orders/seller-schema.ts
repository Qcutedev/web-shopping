/**
 * Seller orders and dashboard summary contract (docs/API_CONTRACTS.md sections 5.7.3 and 5.7.4;
 * REQ-S-03, REQ-S-07, REQ-S-08, BR-09, BR-14, BR-21, BR-25, BR-29, BR-33, BR-35, BR-39): the Zod
 * schemas of the request input and the types of every response shape. Authoritative for
 * `/api/v1/seller/orders/**` and `/api/v1/seller/summary`; the document must match them.
 *
 * The store is always the session's (CLAUDE.md rule 6). The status body is a strict object
 * (section 1.1): `storeId`, `fulfilmentStatus`, `from`, an amount, or any other unknown key is
 * `400 VALIDATION_ERROR` and nothing changes. A `storeId` in a query is not interpreted: the
 * query schema strips unknown parameters.
 *
 * Text limits (item 8.2-7, set for this endpoint in T-043; **provisional** until the owner or the
 * orchestrator rules, each one constant below): `carrierName` and `trackingNumber` are one line,
 * trimmed, 1 to 100 characters, the display-name rule (`NAME_ALLOWED_TEXT`).
 *
 * Money is integer satang (section 1.5). Times are ISO 8601 strings in UTC (section 1.6).
 */
import { z } from "zod";

import { NAME_ALLOWED_TEXT } from "@/modules/auth/schema";
import { type ImageRef, paginationQuerySchema } from "@/modules/catalog/schema";

import { orderIdSchema, type ShipmentDto, type ShippingAddressDto } from "./schema";
import {
  type CancellationKind,
  FULFILMENT_STATUSES,
  type FulfilmentStatusValue,
  type PaymentStatusValue,
} from "./state";

/** Provisional text limits (file comment). */
export const CARRIER_NAME_MAX = 100;
export const TRACKING_NUMBER_MAX = 100;

/** The statuses a seller may ask for (section 5.7.3). `PENDING` is never a target. */
export const SELLER_TARGET_STATUSES = ["PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"] as const;
export type SellerTargetStatus = (typeof SELLER_TARGET_STATUSES)[number];

// ---------------------------------------------------------------------------------------------
// Path parameters and query
// ---------------------------------------------------------------------------------------------

/** The `{id}` path parameter: a seller order id, form only (section 1.4). */
export const sellerOrderIdParamsSchema = z.object({ id: orderIdSchema });
export type SellerOrderIdParams = z.infer<typeof sellerOrderIdParamsSchema>;

const queryString = z.string({ error: "Must be given at most once." });

/**
 * Page, page size (section 1.7), and the filter `fulfilmentStatus`. Every other parameter, a
 * `storeId` or a `paymentStatus` included, is not interpreted: the schema strips it.
 */
export const listSellerOrdersQuerySchema = paginationQuerySchema.extend({
  fulfilmentStatus: queryString.pipe(z.enum(FULFILMENT_STATUSES)).optional(),
});
export type ListSellerOrdersQuery = z.infer<typeof listSellerOrdersQuerySchema>;

// ---------------------------------------------------------------------------------------------
// POST /seller/orders/{id}/status
// ---------------------------------------------------------------------------------------------

const DISPLAY_TEXT_MESSAGE =
  "Must contain a visible character and no control, format, or invisible character.";

function oneLineText(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(NAME_ALLOWED_TEXT, { error: DISPLAY_TEXT_MESSAGE });
}

/**
 * `{ to, carrierName?, trackingNumber? }`. `carrierName` and `trackingNumber` are accepted only
 * with `to: "SHIPPED"`; with any other `to` either one is 400 at its own path (code `custom`).
 * Both are optional and seller-entered: **shipping is simulated**, no carrier is contacted and no
 * tracking number is generated.
 */
export const sellerOrderStatusBodySchema = z
  .strictObject({
    to: z.enum(SELLER_TARGET_STATUSES),
    carrierName: oneLineText(CARRIER_NAME_MAX).optional(),
    trackingNumber: oneLineText(TRACKING_NUMBER_MAX).optional(),
  })
  .superRefine((body, context) => {
    if (body.to === "SHIPPED") return;
    for (const key of ["carrierName", "trackingNumber"] as const) {
      if (body[key] !== undefined) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: 'Only accepted with to: "SHIPPED".',
        });
      }
    }
  });
export type SellerOrderStatusBody = z.infer<typeof sellerOrderStatusBodySchema>;

// ---------------------------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------------------------

/** An item of a seller order as its seller sees it: copies taken at purchase (BR-09). */
export interface SellerOrderItemDto {
  id: string;
  productId: string;
  productTitle: string;
  productSku: string;
  image: ImageRef | null;
  unitPriceSatang: number;
  quantity: number;
  lineTotalSatang: number;
}

/**
 * A seller order as its seller sees it (section 5.7.3): the store's own portion of an order only,
 * never another store's portion and never the order's grand total.
 */
export interface SellerOrderViewDto {
  id: string;
  /** The order's number (BR-37); opaque. */
  orderNumber: string;
  /** When the order was created. */
  createdAt: string;
  /**
   * When the order's payment became `PAID` (BR-39): the paid time of the whole order, the same
   * for every store's part. Never null here, because a seller sees only paid orders (BR-35).
   */
  paidAt: string;
  /** Always `PAID`: a seller never sees an order that is not paid (BR-35). */
  paymentStatus: PaymentStatusValue;
  fulfilmentStatus: FulfilmentStatusValue;
  /** `REFUND_OUTSIDE_SYSTEM` for a cancelled seller order (BR-21), else null. */
  cancellationKind: CancellationKind | null;
  /** The store's name as it was at purchase (BR-09). */
  storeName: string;
  itemsSubtotalSatang: number;
  /** A simulated flat rate, copied at purchase (BR-08). */
  shippingFeeSatang: number;
  shippingFeeIsSimulated: boolean;
  /** Copied at purchase; recorded only, nothing is deducted (BR-13). */
  commissionRateBps: number;
  /** The buyer's shipping copy taken at purchase (BR-09). */
  shippingAddress: ShippingAddressDto;
  shipment: ShipmentDto | null;
  items: SellerOrderItemDto[];
}

/** `GET /seller/summary` (section 5.7.4; REQ-S-03). Every figure is computed from rows. */
export interface SellerSummaryDto {
  /** The store's products by `status`, every status present (0 when none). */
  productsByStatus: Record<"DRAFT" | "PUBLISHED" | "ARCHIVED", number>;
  /** On sale (PUBLISHED and APPROVED) with stock 1 to 5 (BR-25). */
  lowStockCount: number;
  /** On sale with stock 0 (BR-25); never part of `lowStockCount`. */
  soldOutCount: number;
  /** The store's seller orders of paid orders, by fulfilment status, every status present. */
  ordersByStatus: Record<FulfilmentStatusValue, number>;
  /**
   * Aggregate (section 1.5; can exceed 32 bits): the sum of `itemsSubtotalSatang` over the
   * store's seller orders whose order is `PAID` and whose status is not `CANCELLED` (BR-21,
   * BR-33). The shipping fee is never part of it.
   */
  paidSalesTotalSatang: number;
}
