import { redirect, unstable_rethrow } from "next/navigation";
import { requireAccountActor } from "@/components/account/account-actor";
import { AccountLoadError } from "@/components/account/load-state";
import { Pagination } from "@/components/ui/pagination";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { ROUTES, signInHref } from "@/lib/routes";
import {
  DEFAULT_PAGE_SIZE,
  listOrders,
  type OrderDto,
  type Page,
  paginationQuerySchema,
  queryRecord,
} from "@/modules/orders";
import type { Actor } from "@/server/auth/actor";
import { isAppError } from "@/server/errors";
import { OrderListView } from "./order-list-view";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Reads `page` and `pageSize` from the address bar through the same schema as the endpoint. An
 * invalid query is not an error page: the list falls back to the first page.
 */
export function orderPageQueryFrom(searchParams: SearchParams): {
  page: number;
  pageSize: number;
} {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) value.forEach((entry) => params.append(key, entry));
    else if (value !== undefined) params.append(key, value);
  }
  const parsed = paginationQuerySchema.safeParse(queryRecord(params));
  return parsed.success
    ? { page: parsed.data.page, pageSize: parsed.data.pageSize }
    : { page: 1, pageSize: DEFAULT_PAGE_SIZE };
}

function hrefForPage(page: number): string {
  return page <= 1 ? ROUTES.orders : `${ROUTES.orders}?page=${page}`;
}

/** Server Component: one page of the signed-in user's orders through the module service. */
export async function OrdersSection({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let actor: Actor;
  try {
    actor = await requireAccountActor(ROUTES.orders);
  } catch (error) {
    unstable_rethrow(error);
    return <AccountLoadError retryHref={ROUTES.orders} />;
  }

  const query = orderPageQueryFrom(await searchParams);
  let result: Page<OrderDto>;
  try {
    result = await listOrders(actor, query);
  } catch (error) {
    unstable_rethrow(error);
    if (isAppError(error) && error.code === "UNAUTHENTICATED") {
      redirect(signInHref(ROUTES.orders));
    }
    return <AccountLoadError retryHref={hrefForPage(query.page)} />;
  }

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  return (
    <div className="flex flex-col gap-6">
      <OrderListView orders={result.items} total={result.total} firstPageHref={hrefForPage(1)} />
      {totalPages > 1 ? (
        <Pagination
          page={result.page}
          totalPages={totalPages}
          hrefForPage={hrefForPage}
          label={th.pagination.label}
          previousLabel={th.pagination.previous}
          nextLabel={th.pagination.next}
          pageLabel={(page) => fill(th.pagination.page, { page })}
        />
      ) : null}
    </div>
  );
}
