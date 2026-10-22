import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { NoticeLabel } from "@/components/ui/notice-label";
import { Price } from "@/components/ui/price";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { formatDateTime } from "@/lib/format";
import { orderHref, ROUTES } from "@/lib/routes";
import type { OrderDto } from "@/modules/orders/schema";
import { PaymentBadge } from "./status-badges";

/**
 * One page of the customer's orders, newest first, failed orders included and marked (BR-20).
 * Amounts are the copies stored at purchase.
 */
export function OrderListView({
  orders,
  total,
  firstPageHref,
}: {
  orders: readonly OrderDto[];
  /** Number of orders of the user, over all pages. */
  total: number;
  /** Link to page 1, offered when the requested page is past the last one. */
  firstPageHref: string;
}) {
  if (orders.length === 0) {
    return total === 0 ? (
      <EmptyState
        title={th.orders.emptyTitle}
        description={th.orders.emptyDescription}
        action={
          <Link href={ROUTES.home} className={buttonVariants({ variant: "primary" })}>
            {th.orders.emptyAction}
          </Link>
        }
      />
    ) : (
      <EmptyState
        title={th.orders.pageEmptyTitle}
        action={
          <Link href={firstPageHref} className={buttonVariants({ variant: "secondary" })}>
            {th.orders.pageEmptyAction}
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="type-small text-foreground-secondary">{fill(th.orders.count, { total })}</p>
      <ul aria-label={th.orders.listLabel} className="flex flex-col gap-4">
        {orders.map((order) => {
          const itemCount = order.sellerOrders.reduce((sum, part) => sum + part.items.length, 0);
          return (
            <Card as="li" key={order.id} padding="panel" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="type-card-title">
                  <span className="text-foreground-secondary">{th.orders.orderNumber} </span>
                  {order.orderNumber}
                </p>
                <PaymentBadge status={order.paymentStatus} />
                {order.payment.isSimulated ? (
                  <NoticeLabel>{th.notice.mockPayment}</NoticeLabel>
                ) : null}
              </div>
              <p className="type-body text-foreground-secondary">
                {th.orders.placedAt} {formatDateTime(order.createdAt)}
                {" · "}
                {fill(th.orders.itemCount, { count: itemCount })}
              </p>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="type-label">
                  <span className="text-foreground-secondary">{th.orders.total} </span>
                  <Price satang={order.grandTotalSatang} size="card" />
                </p>
                <Link
                  href={orderHref(order.id)}
                  className={buttonVariants({ variant: "secondary", size: "sm" })}
                >
                  {th.orders.view}
                  <span className="sr-only"> {order.orderNumber}</span>
                </Link>
              </div>
            </Card>
          );
        })}
      </ul>
    </div>
  );
}
