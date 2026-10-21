import { queryRecord } from "@/modules/catalog/schema";
import {
  type ListSellerOrdersQuery,
  listSellerOrdersQuerySchema,
} from "@/modules/orders/seller-schema";
import { SELLER_ROUTES } from "./routes";

type SearchParams = Record<string, string | string[] | undefined>;

/** The query of the order list page. Same schema as the endpoint; invalid falls back to defaults. */
export function orderListQueryFrom(searchParams: SearchParams): ListSellerOrdersQuery {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) value.forEach((entry) => params.append(key, entry));
    else if (value !== undefined) params.append(key, value);
  }
  const parsed = listSellerOrdersQuerySchema.safeParse(queryRecord(params));
  return parsed.success
    ? parsed.data
    : listSellerOrdersQuerySchema.parse(queryRecord(new URLSearchParams()));
}

/** Address of an order list page: only the parameters that differ from the defaults. */
export function ordersHref(query: ListSellerOrdersQuery, page: number): string {
  const search = new URLSearchParams();
  if (query.fulfilmentStatus !== undefined) search.set("fulfilmentStatus", query.fulfilmentStatus);
  if (Number.isSafeInteger(page) && page > 1) search.set("page", String(page));
  const text = search.toString();
  return text === "" ? SELLER_ROUTES.orders : `${SELLER_ROUTES.orders}?${text}`;
}
