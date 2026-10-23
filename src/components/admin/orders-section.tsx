import { InputField } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { th } from "@/i18n/th";
import { listOrders } from "@/modules/admin";
import type { AdminOrderDto } from "@/modules/admin/schema";
import { FULFILMENT_STATUSES, PAYMENT_STATUSES } from "@/modules/orders/state";
import { AdminListView, FilterForm } from "./list-view";
import { listHref, ORDER_KEYS, parseOrders, type ParsedList } from "./queries";
import { OrdersTable } from "./orders-table";
import { ADMIN_ROUTES } from "./routes";
import type { SearchParams } from "./search-params";
import { renderForAdmin } from "./with-admin";

/**
 * One page of all orders, newest first, with the filters of REQ-A-07: payment and fulfilment
 * status, order number, store, buyer, the creation date, and the paid date (BR-40). Days are
 * calendar days in Asia/Bangkok, first and last both included. The paid range needs both ends.
 */
export function OrdersListView({
  parsed,
  items,
  total,
}: {
  parsed: ParsedList<{ page: number; pageSize: number }>;
  items: readonly AdminOrderDto[];
  total: number;
}) {
  const { params, query } = parsed;
  const filter = th.admin.orders.filter;
  return (
    <AdminListView
      ignored={parsed.ignored}
      itemCount={items.length}
      total={total}
      page={query.page}
      pageSize={query.pageSize}
      filtered={ORDER_KEYS.some((key) => params.has(key))}
      basePath={ADMIN_ROUTES.orders}
      hrefForPage={(page) =>
        listHref(ADMIN_ROUTES.orders, ORDER_KEYS, params, query.pageSize, page)
      }
      emptyTitle={th.admin.orders.emptyTitle}
      filterForm={
        <FilterForm
          action={ADMIN_ROUTES.orders}
          label={filter.title}
          resetHref={ADMIN_ROUTES.orders}
        >
          <InputField
            name="orderNumber"
            label={filter.orderNumber}
            defaultValue={params.get("orderNumber") ?? ""}
            maxLength={24}
            autoComplete="off"
          />
          <SelectField
            name="paymentStatus"
            label={filter.payment}
            defaultValue={params.get("paymentStatus") ?? ""}
          >
            <option value="">{th.admin.common.all}</option>
            {PAYMENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status === "FAILED" ? th.order.paymentFailed : th.orders.status.payment[status]}
              </option>
            ))}
          </SelectField>
          <SelectField
            name="fulfilmentStatus"
            label={filter.fulfilment}
            helperText={filter.fulfilmentHelper}
            defaultValue={params.get("fulfilmentStatus") ?? ""}
          >
            <option value="">{th.admin.common.all}</option>
            {FULFILMENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {th.orders.status.fulfilment[status]}
              </option>
            ))}
          </SelectField>
          <InputField
            name="storeId"
            label={filter.store}
            defaultValue={params.get("storeId") ?? ""}
            maxLength={200}
            autoComplete="off"
          />
          <InputField
            name="userId"
            label={filter.user}
            defaultValue={params.get("userId") ?? ""}
            maxLength={200}
            autoComplete="off"
          />
          <div className="hidden lg:block" aria-hidden="true" />
          <fieldset className="flex flex-col gap-2 sm:col-span-2 lg:col-span-1">
            <legend className="type-label mb-2">{filter.createdRange}</legend>
            <InputField
              type="date"
              name="from"
              label={th.admin.common.dateFrom}
              defaultValue={params.get("from") ?? ""}
            />
            <InputField
              type="date"
              name="to"
              label={th.admin.common.dateTo}
              helperText={th.admin.common.dateNote}
              defaultValue={params.get("to") ?? ""}
            />
          </fieldset>
          <fieldset className="flex flex-col gap-2 sm:col-span-2 lg:col-span-1">
            <legend className="type-label mb-2">{filter.paidRange}</legend>
            <InputField
              type="date"
              name="paidFrom"
              label={th.admin.common.dateFrom}
              defaultValue={params.get("paidFrom") ?? ""}
            />
            <InputField
              type="date"
              name="paidTo"
              label={th.admin.common.dateTo}
              helperText={filter.paidRangeHelper}
              defaultValue={params.get("paidTo") ?? ""}
            />
          </fieldset>
        </FilterForm>
      }
      table={<OrdersTable items={items} />}
    />
  );
}

/** Server Component: one page of orders through the module service. */
export async function OrdersSection({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const parsed = parseOrders(await searchParams);
  return renderForAdmin(ADMIN_ROUTES.orders, async (actor) => {
    const page = await listOrders(actor, parsed.query);
    return <OrdersListView parsed={parsed} items={page.items} total={page.total} />;
  });
}
