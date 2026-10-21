"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { NoticeLabel } from "@/components/ui/notice-label";
import { Price } from "@/components/ui/price";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { formatDateTime } from "@/lib/format";
import type { SellerOrderListItemDto } from "@/modules/orders/seller-schema";
import { formatCount } from "./format-count";
import { sellerOrderHref } from "./routes";
import { FulfilmentBadge, PaymentBadge } from "./status-badges";

/**
 * The store's orders as a data table (design system: dashboards use Table). A Client Component
 * because the Table primitive keeps its density in a React context. Each row is the store's own
 * portion of an order as the server returned it; no total of a whole order is shown.
 */
export function OrdersTable({ items }: { items: readonly SellerOrderListItemDto[] }) {
  return (
    <Table caption={th.seller.orders.listLabel} captionHidden density="dense" stacked>
      <TableHeader>
        <TableRow interactive={false}>
          <TableHead>{th.seller.orders.columns.order}</TableHead>
          <TableHead>{th.seller.orders.columns.placedAt}</TableHead>
          <TableHead>{th.seller.orders.columns.status}</TableHead>
          <TableHead align="end">{th.seller.orders.columns.items}</TableHead>
          <TableHead align="end">{th.seller.orders.columns.subtotal}</TableHead>
          <TableHead align="end">{th.seller.orders.columns.shippingFee}</TableHead>
          <TableHead>
            <span className="sr-only">{th.seller.orders.columns.actions}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((order) => (
          <TableRow key={order.id}>
            <TableCell rowHeader>
              <Link
                href={sellerOrderHref(order.id)}
                className="focus-ring type-label rounded-sm underline-offset-4 hover:underline"
              >
                {order.orderNumber}
              </Link>
            </TableCell>
            <TableCell label={th.seller.orders.columns.placedAt}>
              {formatDateTime(order.createdAt)}
            </TableCell>
            <TableCell label={th.seller.orders.columns.status}>
              <div className="flex flex-wrap items-center gap-2">
                <FulfilmentBadge status={order.fulfilmentStatus} />
                <PaymentBadge status={order.paymentStatus} />
              </div>
              {order.cancellationKind !== null ? (
                <p className="type-small text-danger mt-1">{th.seller.orders.row.cancelledNote}</p>
              ) : null}
            </TableCell>
            <TableCell align="end" label={th.seller.orders.columns.items}>
              {fill(th.seller.orders.row.itemCount, { count: formatCount(order.items.length) })}
            </TableCell>
            <TableCell align="end" label={th.seller.orders.columns.subtotal}>
              <Price satang={order.itemsSubtotalSatang} />
            </TableCell>
            <TableCell align="end" label={th.seller.orders.columns.shippingFee}>
              <div className="flex flex-col items-end gap-1">
                <Price satang={order.shippingFeeSatang} />
                {order.shippingFeeIsSimulated ? (
                  <NoticeLabel>{th.notice.simulatedShipping}</NoticeLabel>
                ) : null}
              </div>
            </TableCell>
            <TableCell>
              <Link
                href={sellerOrderHref(order.id)}
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                {th.seller.orders.row.view}
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
