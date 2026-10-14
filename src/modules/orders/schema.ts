/**
 * Orders contract (docs/API_CONTRACTS.md sections 5.5.2 and 5.5.4; REQ-C-12, REQ-C-13, BR-09,
 * BR-20, BR-21, BR-32, BR-37, BR-39): the Zod schemas of the request input and the types of the
 * order shape. Authoritative for `GET /api/v1/orders`, `GET /api/v1/orders/{id}`, and the body of
 * a `POST /api/v1/checkout` answer; the document must match them.
 *
 * Money is integer satang (section 1.5). Times are ISO 8601 strings in UTC (section 1.6).
 */
import { z } from "zod";

import type { ImageRef } from "@/modules/catalog/schema";
import type { PaymentFailureReason, PaymentProviderName } from "@/modules/payments";

import type { CancellationKind, FulfilmentStatusValue, PaymentStatusValue } from "./state";

export {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type Page,
  type PaginationQuery,
  paginationQuerySchema,
  queryRecord,
} from "@/modules/catalog/schema";

/**
 * Longest id accepted in a path. Ids are opaque (section 1.4); the bound only stops absurd input
 * and never refuses a real id (a `cuid(2)` is 24 characters).
 */
export const MAX_ID_LENGTH = 200;

/**
 * An opaque id, validated for its form only (section 1.8 step 7): 1 to MAX_ID_LENGTH characters,
 * no U+0000 and no lone surrogate, which no stored id contains and a query could not carry as sent.
 */
export const orderIdSchema = z
  .string()
  .min(1)
  .max(MAX_ID_LENGTH)
  .refine((value) => !value.includes("\u0000") && value.isWellFormed(), {
    error: "Must not contain U+0000 or a lone surrogate.",
  });

/** The `{id}` path parameter of `GET /orders/{id}`. */
export const orderIdParamsSchema = z.object({ id: orderIdSchema });
export type OrderIdParams = z.infer<typeof orderIdParamsSchema>;

// ---------------------------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------------------------

export interface PaymentDto {
  /** `"MOCK"` in the MVP: a mock payment, no money moves (section 1.9). */
  provider: PaymentProviderName;
  /** Derived from `provider` (finding M1); `true` for the mock. */
  isSimulated: boolean;
  /** `null` unless the payment failed (closed list, item 8.2-5). */
  failureReason: PaymentFailureReason | null;
}

export interface ShippingAddressDto {
  recipientName: string;
  phone: string;
  line1: string;
  subdistrict: string;
  district: string;
  province: string;
  postalCode: string;
}

export interface ShipmentDto {
  carrierName: string | null;
  trackingNumber: string | null;
  /** Always true in the MVP: no carrier is contacted (section 1.9). */
  isSimulated: boolean;
  shippedAt: string;
  deliveredAt: string | null;
}

export interface OrderReviewDto {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}

export interface OrderItemDto {
  id: string;
  productId: string;
  /** Copies taken at purchase (BR-09). */
  productTitle: string;
  productSku: string;
  image: ImageRef | null;
  unitPriceSatang: number;
  quantity: number;
  lineTotalSatang: number;
  review: OrderReviewDto | null;
}

export interface SellerOrderDto {
  id: string;
  /** The store's name as it was at purchase (OQ-18). */
  storeName: string;
  /** For linking only. */
  storeSlug: string;
  fulfilmentStatus: FulfilmentStatusValue;
  cancellationKind: CancellationKind | null;
  itemsSubtotalSatang: number;
  /** A simulated flat rate, copied at purchase (BR-08). */
  shippingFeeSatang: number;
  shippingFeeIsSimulated: boolean;
  shipment: ShipmentDto | null;
  items: OrderItemDto[];
}

export interface CartReturnItemDto {
  productId: string;
  /** What the failed order held. */
  orderedQuantity: number;
  /** The quantity of that product's cart line just after the return (not the cart now). */
  cartQuantity: number;
  /** True when the line ended lower than its earlier quantity plus `orderedQuantity`. */
  capped: boolean;
}

export interface CartReturnDto {
  /** True when any entry is capped. */
  capped: boolean;
  items: CartReturnItemDto[];
}

export interface OrderDto {
  id: string;
  /** Database-assigned, at most 24 characters, opaque (section 1.4). */
  orderNumber: string;
  createdAt: string;
  /**
   * When the payment became `PAID` (BR-39; D-033 point 4). `null` while `PENDING` and for ever
   * when `FAILED`; never replaced by another time.
   */
  paidAt: string | null;
  paymentStatus: PaymentStatusValue;
  payment: PaymentDto;
  itemsSubtotalSatang: number;
  shippingTotalSatang: number;
  grandTotalSatang: number;
  /** Copy taken at purchase (BR-09). */
  shippingAddress: ShippingAddressDto;
  sellerOrders: SellerOrderDto[];
  /** How the items came back to the cart after a failed payment (section 5.5.4); else `null`. */
  cartReturn: CartReturnDto | null;
}
