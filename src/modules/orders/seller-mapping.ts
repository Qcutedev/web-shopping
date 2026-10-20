/**
 * From stored rows to the seller's shapes of docs/API_CONTRACTS.md sections 5.7.3 and 5.7.4.
 * Pure: no database and no I/O.
 *
 * Everything in a seller order is a copy taken at purchase (BR-09) or a status; nothing is read
 * from the live product, store, address, or settings. The order's grand total and every other
 * store's portion are never in it (section 5.7.3).
 */
import { imageRef } from "@/modules/catalog/image";

import type { SellerOrderViewDto, SellerSummaryDto } from "./seller-schema";
import type { SellerOrderViewRow, SellerSummaryRows } from "./seller-repository";
import { cancellationKind, FULFILMENT_STATUSES, type FulfilmentStatusValue } from "./state";

export function toSellerOrderViewDto(row: SellerOrderViewRow): SellerOrderViewDto {
  if (row.order.paymentStatus !== "PAID" || row.order.paidAt === null) {
    // Every seller read is filtered on a paid order (BR-35), and the database ties `paidAt` to
    // `PAID` (`Order_paidAt_check`). Anything else is a fault, never a shape with a null time.
    throw new Error("orders: a seller order of an order that is not paid reached the mapping.");
  }
  return {
    id: row.id,
    orderNumber: row.order.orderNumber,
    createdAt: row.order.createdAt.toISOString(),
    paidAt: row.order.paidAt.toISOString(),
    paymentStatus: row.order.paymentStatus,
    fulfilmentStatus: row.fulfilmentStatus,
    cancellationKind: cancellationKind(row.fulfilmentStatus, row.order.paymentStatus),
    storeName: row.storeName,
    itemsSubtotalSatang: row.itemsSubtotalSatang,
    shippingFeeSatang: row.shippingFeeSatang,
    shippingFeeIsSimulated: row.shippingFeeIsSimulated,
    commissionRateBps: row.commissionRateBps,
    shippingAddress: {
      recipientName: row.order.shipRecipientName,
      phone: row.order.shipPhone,
      line1: row.order.shipLine1,
      subdistrict: row.order.shipSubdistrict,
      district: row.order.shipDistrict,
      province: row.order.shipProvince,
      postalCode: row.order.shipPostalCode,
    },
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
    items: row.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productTitle: item.productTitle,
      productSku: item.productSku,
      image: item.imageKey === null ? null : imageRef(item.imageKey),
      unitPriceSatang: item.unitPriceSatang,
      quantity: item.quantity,
      lineTotalSatang: item.lineTotalSatang,
    })),
  };
}

/**
 * An aggregate of integer satang sent as a JSON number (section 1.5): only after checking that it
 * is a safe integer. A sum beyond 2^53 - 1 cannot be sent exactly and is a fault (500), never a
 * rounded figure.
 */
export function aggregateSatang(decimalText: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(decimalText)) {
    throw new RangeError("orders: an aggregate is not a non-negative integer.");
  }
  const value = BigInt(decimalText);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("orders: an aggregate is above the largest safe integer.");
  }
  return Number(value);
}

const PRODUCT_STATUS_KEYS = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;

function countsBy<K extends string>(
  keys: readonly K[],
  rows: readonly { status: string; count: number }[],
): Record<K, number> {
  const result = Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
  for (const row of rows) {
    if (!(keys as readonly string[]).includes(row.status)) {
      throw new Error("orders: a status outside the known values reached the summary.");
    }
    result[row.status as K] = row.count;
  }
  return result;
}

/** The summary shape: every status present (0 when none), the aggregate checked. */
export function toSellerSummaryDto(rows: SellerSummaryRows): SellerSummaryDto {
  return {
    productsByStatus: countsBy(PRODUCT_STATUS_KEYS, rows.productsByStatus),
    lowStockCount: rows.lowStockCount,
    soldOutCount: rows.soldOutCount,
    ordersByStatus: countsBy<FulfilmentStatusValue>(FULFILMENT_STATUSES, rows.ordersByStatus),
    paidSalesTotalSatang: aggregateSatang(rows.paidSalesTotal),
  };
}
