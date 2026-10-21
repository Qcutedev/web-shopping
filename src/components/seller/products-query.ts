import {
  type ListSellerProductsQuery,
  listSellerProductsQuerySchema,
  queryRecord,
} from "@/modules/inventory/schema";
import { SELLER_ROUTES } from "./routes";

type SearchParams = Record<string, string | string[] | undefined>;

function toUrlSearchParams(searchParams: SearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) value.forEach((entry) => params.append(key, entry));
    else if (value !== undefined) params.append(key, value);
  }
  return params;
}

/** The query of a product list page. Same schema as the endpoint. */
export function productListQueryFrom(searchParams: SearchParams): {
  query: ListSellerProductsQuery;
  /** False when the address bar held an invalid query and the defaults were used instead. */
  valid: boolean;
} {
  const parsed = listSellerProductsQuerySchema.safeParse(
    queryRecord(toUrlSearchParams(searchParams)),
  );
  if (parsed.success) return { query: parsed.data, valid: true };
  return {
    query: listSellerProductsQuerySchema.parse(queryRecord(new URLSearchParams())),
    valid: false,
  };
}

/** Address of a product list page: only the parameters that differ from the defaults. */
export function productsHref(query: ListSellerProductsQuery, page: number): string {
  const search = new URLSearchParams();
  if (query.status !== undefined) search.set("status", query.status);
  if (query.moderationStatus !== undefined) search.set("moderationStatus", query.moderationStatus);
  if (query.lowStock === true) search.set("lowStock", "true");
  if (query.soldOut === true) search.set("soldOut", "true");
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
