/**
 * From stored order rows to the order shape of docs/API_CONTRACTS.md sections 5.5.2 and 5.5.4,
 * and the arithmetic of a failed payment's return to the cart (BR-32; DATA_MODEL.md section 7.2).
 * Pure: no database and no I/O.
 *
 * Everything in the shape is a copy taken at purchase (BR-09) or a status; nothing is read from
 * the live product, store, address, or settings. The commission rate is never in the customer's
 * shape (BR-13).
 */
import { imageRef } from "@/modules/catalog/image";
import {
  isSimulatedProvider,
  PAYMENT_FAILURE_REASONS,
  type PaymentFailureReason,
  type PaymentProviderName,
} from "@/modules/payments";

import type { CartReturnDto, OrderDto, OrderItemDto, SellerOrderDto } from "./schema";
import { cancellationKind, type FulfilmentStatusValue, type PaymentStatusValue } from "./state";

/** Largest quantity of a cart line (BR-03; `CartItem_quantity_check`). */
export const MAX_CART_LINE_QUANTITY = 99;

/**
 * The quantity of a cart line after a failed order's item returns to it (BR-32; DATA_MODEL.md
 * section 7.2 step 5): the line's earlier quantity plus the item's, capped at 99 and at the stock
 * as it stands after the item's stock was restored. `existing` is 0 when there was no line.
 */
export function returnedLineQuantity(existing: number, ordered: number, stock: number): number {
  for (const value of [existing, ordered, stock]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError("returnedLineQuantity: a quantity is not a non-negative integer.");
    }
  }
  if (ordered < 1 || stock < ordered) {
    // The restore has just added `ordered` to the stock under the row lock, so this cannot hold
    // for a real item; refusing keeps a CHECK violation (quantity 0) out of the transaction.
    throw new RangeError("returnedLineQuantity: the stock is below the returned quantity.");
  }
  return Math.min(existing + ordered, MAX_CART_LINE_QUANTITY, stock);
}

export interface OrderItemRow {
  id: string;
  productId: string;
  productTitle: string;
  productSku: string;
  productImageUpload: { storageKey: string } | null;
  unitPriceSatang: number;
  quantity: number;
  lineTotalSatang: number;
  cartQuantityBeforeReturn: number | null;
  cartQuantityAfterReturn: number | null;
  review: { id: string; rating: number; comment: string | null; createdAt: Date } | null;
}

export interface SellerOrderRow {
  id: string;
  storeName: string;
  store: { slug: string };
  fulfilmentStatus: FulfilmentStatusValue;
  itemsSubtotalSatang: number;
  shippingFeeSatang: number;
  shippingFeeIsSimulated: boolean;
  shipment: {
    carrierName: string | null;
    trackingNumber: string | null;
    isSimulated: boolean;
    shippedAt: Date;
    deliveredAt: Date | null;
  } | null;
  items: OrderItemRow[];
}

export interface OrderRow {
  id: string;
  orderNumber: string;
  createdAt: Date;
  paidAt: Date | null;
  paymentStatus: PaymentStatusValue;
  itemsSubtotalSatang: number;
  shippingTotalSatang: number;
  grandTotalSatang: number;
  shipRecipientName: string;
  shipPhone: string;
  shipLine1: string;
  shipSubdistrict: string;
  shipDistrict: string;
  shipProvince: string;
  shipPostalCode: string;
  payment: { provider: PaymentProviderName; failureReason: string | null } | null;
  sellerOrders: SellerOrderRow[];
}

/** A stored reason outside the closed list is not passed on (a client treats null as "failed"). */
function toFailureReason(value: string | null): PaymentFailureReason | null {
  if (value === null) return null;
  return (PAYMENT_FAILURE_REASONS as readonly string[]).includes(value)
    ? (value as PaymentFailureReason)
    : null;
}

function toItem(row: OrderItemRow): OrderItemDto {
  return {
    id: row.id,
    productId: row.productId,
    productTitle: row.productTitle,
    productSku: row.productSku,
    image: row.productImageUpload === null ? null : imageRef(row.productImageUpload.storageKey),
    unitPriceSatang: row.unitPriceSatang,
    quantity: row.quantity,
    lineTotalSatang: row.lineTotalSatang,
    review:
      row.review === null
        ? null
        : {
            id: row.review.id,
            rating: row.review.rating,
            comment: row.review.comment,
            createdAt: row.review.createdAt.toISOString(),
          },
  };
}

function toSellerOrder(row: SellerOrderRow, paymentStatus: PaymentStatusValue): SellerOrderDto {
  return {
    id: row.id,
    storeName: row.storeName,
    storeSlug: row.store.slug,
    fulfilmentStatus: row.fulfilmentStatus,
    cancellationKind: cancellationKind(row.fulfilmentStatus, paymentStatus),
    itemsSubtotalSatang: row.itemsSubtotalSatang,
    shippingFeeSatang: row.shippingFeeSatang,
    shippingFeeIsSimulated: row.shippingFeeIsSimulated,
    shipment:
      row.shipment === null
        ? null
        : {
            carrierName: row.shipment.carrierName,
            trackingNumber: row.shipment.trackingNumber,
            isSimulated: row.shipment.isSimulated,
            shippedAt: row.shipment.shippedAt.toISOString(),
            deliveredAt: row.shipment.deliveredAt?.toISOString() ?? null,
          },
    items: row.items.map(toItem),
  };
}

/**
 * `cartReturn` (section 5.5.4): read from what the failure stored on each order item, so it is
 * the same in every response that carries the failed order. `null` unless the payment failed.
 * An item of a part cancelled before the failure has no record and no entry.
 */
export function toCartReturn(row: OrderRow): CartReturnDto | null {
  if (row.paymentStatus !== "FAILED") return null;
  const items = row.sellerOrders.flatMap((sellerOrder) =>
    sellerOrder.items.flatMap((item) => {
      if (item.cartQuantityAfterReturn === null || item.cartQuantityBeforeReturn === null) {
        return [];
      }
      return [
        {
          productId: item.productId,
          orderedQuantity: item.quantity,
          cartQuantity: item.cartQuantityAfterReturn,
          capped: item.cartQuantityAfterReturn < item.cartQuantityBeforeReturn + item.quantity,
        },
      ];
    }),
  );
  return { capped: items.some((item) => item.capped), items };
}

export function toOrderDto(row: OrderRow): OrderDto {
  if (row.payment === null) {
    // Checkout writes the Payment row in the same transaction as the order.
    throw new Error("orders: an order has no payment row.");
  }
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    createdAt: row.createdAt.toISOString(),
    // BR-39: only a paid order shows a paid time. The database ties the two (`Order_paidAt_check`).
    paidAt: row.paymentStatus === "PAID" ? (row.paidAt?.toISOString() ?? null) : null,
    paymentStatus: row.paymentStatus,
    payment: {
      provider: row.payment.provider,
      isSimulated: isSimulatedProvider(row.payment.provider),
      failureReason:
        row.paymentStatus === "FAILED" ? toFailureReason(row.payment.failureReason) : null,
    },
    itemsSubtotalSatang: row.itemsSubtotalSatang,
    shippingTotalSatang: row.shippingTotalSatang,
    grandTotalSatang: row.grandTotalSatang,
    shippingAddress: {
      recipientName: row.shipRecipientName,
      phone: row.shipPhone,
      line1: row.shipLine1,
      subdistrict: row.shipSubdistrict,
      district: row.shipDistrict,
      province: row.shipProvince,
      postalCode: row.shipPostalCode,
    },
    sellerOrders: row.sellerOrders.map((sellerOrder) =>
      toSellerOrder(sellerOrder, row.paymentStatus),
    ),
    cartReturn: toCartReturn(row),
  };
}
