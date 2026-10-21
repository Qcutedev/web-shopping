import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { NoticeLabel } from "@/components/ui/notice-label";
import { Pagination } from "@/components/ui/pagination";
import { Price } from "@/components/ui/price";
import { SelectField } from "@/components/ui/select";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { formatDateTime } from "@/lib/format";
import {
  type ListSellerOrdersQuery,
  type SellerOrderListItemDto,
} from "@/modules/orders/seller-schema";
import { FULFILMENT_STATUSES } from "@/modules/orders/state";
import { ordersHref } from "./orders-query";
import { SELLER_ROUTES, sellerOrderHref } from "./routes";
import { formatCount } from "./format-count";
import { FulfilmentBadge, PaymentBadge } from "./status-badges";

function FilterForm({ query }: { query: ListSellerOrdersQuery }) {
  return (
    <form
      method="get"
      action={SELLER_ROUTES.orders}
      aria-label={th.seller.orders.filter.title}
      className="border-border bg-surface flex flex-col gap-4 rounded-md border p-4"
    >
      <SelectField
        name="fulfilmentStatus"
        label={th.seller.orders.filter.status}
        defaultValue={query.fulfilmentStatus ?? ""}
        fieldClassName="sm:max-w-xs"
      >
        <option value="">{th.seller.orders.filter.all}</option>
        {FULFILMENT_STATUSES.map((status) => (
          <option key={status} value={status}>
            {th.seller.status.fulfilment[status]}
          </option>
        ))}
      </SelectField>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit">{th.seller.orders.filter.apply}</Button>
        <Link
          href={SELLER_ROUTES.orders}
          className="type-label focus-ring inline-flex min-h-11 items-center rounded-sm underline underline-offset-4"
        >
          {th.seller.orders.filter.reset}
        </Link>
      </div>
    </form>
  );
}

function OrderRow({ order }: { order: SellerOrderListItemDto }) {
  return (
    <Card as="li" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="type-card-title">
          <Link
            href={sellerOrderHref(order.id)}
            className="focus-ring rounded-sm underline-offset-4 hover:underline"
          >
            {th.seller.orders.row.orderNumber} {order.orderNumber}
          </Link>
        </h2>
        <FulfilmentBadge status={order.fulfilmentStatus} />
        <PaymentBadge status={order.paymentStatus} />
      </div>
      <p className="type-small text-foreground-secondary">
        {th.seller.orders.row.placedAt} {formatDateTime(order.createdAt)}{" "}
        {th.seller.common.dotSeparator}
        {fill(th.seller.orders.row.itemCount, { count: formatCount(order.items.length) })}
      </p>
      {order.cancellationKind !== null ? (
        <p className="type-small text-danger">{th.seller.orders.row.cancelledNote}</p>
      ) : null}
      <dl className="flex flex-wrap gap-x-8 gap-y-1">
        <div className="flex gap-2">
          <dt className="type-small text-foreground-secondary">{th.seller.orders.row.subtotal}</dt>
          <dd className="type-label">
            <Price satang={order.itemsSubtotalSatang} />
          </dd>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <dt className="type-small text-foreground-secondary">
            {th.seller.orders.row.shippingFee}
          </dt>
          <dd className="type-label">
            <Price satang={order.shippingFeeSatang} />
          </dd>
          {order.shippingFeeIsSimulated ? (
            <NoticeLabel>{th.notice.simulatedShipping}</NoticeLabel>
          ) : null}
        </div>
      </dl>
      <div>
        <Link
          href={sellerOrderHref(order.id)}
          className={buttonVariants({ variant: "secondary", size: "sm" })}
        >
          {th.seller.orders.row.view}
        </Link>
      </div>
    </Card>
  );
}

/**
 * One page of the store's paid orders with the status filter (REQ-S-07). Rows are the store's own
 * portion of each order as the server returned it; no total of a whole order is shown.
 */
export function OrdersListView({
  query,
  items,
  total,
}: {
  query: ListSellerOrdersQuery;
  items: readonly SellerOrderListItemDto[];
  total: number;
}) {
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const filtered = query.fulfilmentStatus !== undefined;

  let body;
  if (items.length > 0) {
    body = (
      <>
        <p role="status" className="type-small text-foreground-secondary">
          {fill(th.seller.orders.count, { count: formatCount(total) })}
        </p>
        <ul aria-label={th.seller.orders.listLabel} className="flex flex-col gap-3">
          {items.map((order) => (
            <OrderRow key={order.id} order={order} />
          ))}
        </ul>
      </>
    );
  } else if (total > 0) {
    body = (
      <EmptyState
        title={th.seller.orders.pageEmptyTitle}
        action={
          <Link href={ordersHref(query, 1)} className={buttonVariants({ variant: "secondary" })}>
            {th.seller.orders.pageEmptyAction}
          </Link>
        }
      />
    );
  } else if (filtered) {
    body = (
      <EmptyState
        title={th.seller.orders.filteredEmptyTitle}
        description={th.seller.orders.filteredEmptyDescription}
        action={
          <Link href={SELLER_ROUTES.orders} className={buttonVariants({ variant: "secondary" })}>
            {th.seller.orders.filter.reset}
          </Link>
        }
      />
    );
  } else {
    body = (
      <EmptyState
        title={th.seller.orders.emptyTitle}
        description={th.seller.orders.emptyDescription}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <FilterForm query={query} />
      {body}
      {totalPages > 1 ? (
        <Pagination
          page={query.page}
          totalPages={totalPages}
          hrefForPage={(page) => ordersHref(query, page)}
          label={th.pagination.label}
          previousLabel={th.pagination.previous}
          nextLabel={th.pagination.next}
          pageLabel={(page) => fill(th.pagination.page, { page })}
        />
      ) : null}
    </div>
  );
}
