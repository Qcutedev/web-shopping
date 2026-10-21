import { DEFAULT_PAGE_SIZE, queryRecord } from "@/modules/catalog/schema";
import {
  type ListSellerOrdersQuery,
  listSellerOrdersQuerySchema,
} from "@/modules/orders/seller-schema";
import { SELLER_ROUTES } from "./routes";
import { type SearchParams, toUrlSearchParams } from "./search-params";

/** The query of the order list page. Same schema as the endpoint; invalid falls back to defaults. */
export function orderListQueryFrom(searchParams: SearchParams): ListSellerOrdersQuery {
  const parsed = listSellerOrdersQuerySchema.safeParse(
    queryRecord(toUrlSearchParams(searchParams)),
  );
  return parsed.success
    ? parsed.data
    : listSellerOrdersQuerySchema.parse(queryRecord(new URLSearchParams()));
}

/** Address of an order list page: only the parameters that differ from the defaults. */
export function ordersHref(query: ListSellerOrdersQuery, page: number): string {
  const search = new URLSearchParams();
  if (query.fulfilmentStatus !== undefined) search.set("fulfilmentStatus", query.fulfilmentStatus);
  if (query.pageSize !== DEFAULT_PAGE_SIZE) search.set("pageSize", String(query.pageSize));
  if (Number.isSafeInteger(page) && page > 1) search.set("page", String(page));
  const text = search.toString();
  return text === "" ? SELLER_ROUTES.orders : `${SELLER_ROUTES.orders}?${text}`;
}
