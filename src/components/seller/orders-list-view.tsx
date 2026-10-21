import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { SelectField } from "@/components/ui/select";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import {
  type ListSellerOrdersQuery,
  type SellerOrderListItemDto,
} from "@/modules/orders/seller-schema";
import { FULFILMENT_STATUSES } from "@/modules/orders/state";
import { OrdersTable } from "./orders-table";
import { ordersHref } from "./orders-query";
import { SELLER_ROUTES } from "./routes";
import { formatCount } from "./format-count";

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
        <OrdersTable items={items} />
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
