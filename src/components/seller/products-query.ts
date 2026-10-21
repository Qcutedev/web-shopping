import { DEFAULT_PAGE_SIZE } from "@/modules/catalog/schema";
import {
  type ListSellerProductsQuery,
  listSellerProductsQuerySchema,
  queryRecord,
} from "@/modules/inventory/schema";
import { SELLER_ROUTES } from "./routes";
import { type SearchParams, toUrlSearchParams } from "./search-params";

/**
 * The query of a product list page. Same schema as the endpoint; an invalid query falls back to
 * the unfiltered first page.
 */
export function productListQueryFrom(searchParams: SearchParams): ListSellerProductsQuery {
  const parsed = listSellerProductsQuerySchema.safeParse(
    queryRecord(toUrlSearchParams(searchParams)),
  );
  return parsed.success
    ? parsed.data
    : listSellerProductsQuerySchema.parse(queryRecord(new URLSearchParams()));
}

/** Address of a product list page: only the parameters that differ from the defaults. */
export function productsHref(query: ListSellerProductsQuery, page: number): string {
  const search = new URLSearchParams();
  if (query.status !== undefined) search.set("status", query.status);
  if (query.moderationStatus !== undefined) search.set("moderationStatus", query.moderationStatus);
  if (query.lowStock === true) search.set("lowStock", "true");
  if (query.soldOut === true) search.set("soldOut", "true");
  if (query.pageSize !== DEFAULT_PAGE_SIZE) search.set("pageSize", String(query.pageSize));
  if (Number.isSafeInteger(page) && page > 1) search.set("page", String(page));
  const text = search.toString();
  return text === "" ? SELLER_ROUTES.products : `${SELLER_ROUTES.products}?${text}`;
}

export function hasProductFilter(query: ListSellerProductsQuery): boolean {
  return (
    query.status !== undefined ||
    query.moderationStatus !== undefined ||
    query.lowStock === true ||
    query.soldOut === true
  );
}
