"use client";

import Link from "next/link";
import { PaymentBadge } from "@/components/orders/status-badges";
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
import { USER_NAME_CONTAINER_CLASS, UserName } from "@/components/user-name";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { formatDateTime } from "@/lib/format";
import type { AdminOrderDto } from "@/modules/admin/schema";
import { formatCount } from "./format-count";
import { PartStatus } from "./part-status";
import { adminOrderHref } from "./routes";

/**
 * All orders as a data table. Every amount is the server's stored copy; the list adds nothing up.
 * Orders whose payment failed carry the approved mark and have no action (BR-20).
 */
export function OrdersTable({ items }: { items: readonly AdminOrderDto[] }) {
  const columns = th.admin.orders.columns;
  return (
    <Table caption={th.admin.orders.listLabel} captionHidden density="dense" stacked>
      <TableHeader>
        <TableRow interactive={false}>
          <TableHead>{columns.order}</TableHead>
          <TableHead>{columns.placedAt}</TableHead>
          <TableHead>{columns.payment}</TableHead>
          <TableHead>{columns.parts}</TableHead>
          <TableHead align="end">{columns.total}</TableHead>
          <TableHead>
            <span className="sr-only">{th.admin.common.view}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((order) => (
          <TableRow key={order.id}>
            <TableCell rowHeader>
              <Link
                href={adminOrderHref(order.id)}
                className="focus-ring type-label rounded-sm underline-offset-4 hover:underline"
              >
                {order.orderNumber}
              </Link>
            </TableCell>
            <TableCell label={columns.placedAt}>{formatDateTime(order.createdAt)}</TableCell>
            <TableCell label={columns.payment}>
              <div className="flex flex-wrap items-center gap-2">
                <PaymentBadge status={order.paymentStatus} />
                {order.payment.isSimulated ? (
                  <NoticeLabel>{th.notice.mockPayment}</NoticeLabel>
                ) : null}
              </div>
            </TableCell>
            <TableCell label={columns.parts} className="min-w-48">
              <ul
                aria-label={fill(th.admin.orders.partsCount, {
                  count: formatCount(order.sellerOrders.length),
                })}
                className="flex flex-col gap-2"
              >
                {order.sellerOrders.map((part) => (
                  <li
                    key={part.id}
                    className={`flex flex-wrap items-center gap-2 ${USER_NAME_CONTAINER_CLASS}`}
                  >
                    <UserName>{part.storeName}</UserName>
                    <PartStatus part={part} />
                  </li>
                ))}
              </ul>
            </TableCell>
            <TableCell align="end" label={columns.total}>
              <Price satang={order.grandTotalSatang} />
            </TableCell>
            <TableCell>
              <Link
                href={adminOrderHref(order.id)}
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                {th.admin.orders.view}
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
