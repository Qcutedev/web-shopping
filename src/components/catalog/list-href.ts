import {
  DEFAULT_PRODUCT_SORT,
  type ListProductsQuery,
  type ProductSort,
} from "@/modules/catalog/schema";

/** Every `ListProductsQuery` filter except paging. A link that drops one loses the visitor's view. */
export interface ListHrefParams {
  q?: string | undefined;
  sort?: ProductSort | undefined;
  category?: string | undefined;
  minPriceSatang?: number | undefined;
  maxPriceSatang?: number | undefined;
}

/**
 * The filters of a parsed query, for `listHref`. A category page holds its category in the path,
 * so it passes `{ category: undefined }` as `override`; a sort link passes `{ sort }`.
 */
export function hrefParamsOf(
  query: ListProductsQuery,
  override: Partial<ListHrefParams> = {},
): ListHrefParams {
  return {
    q: query.q,
    sort: query.sort,
    category: query.category,
    minPriceSatang: query.minPriceSatang,
    maxPriceSatang: query.maxPriceSatang,
    ...override,
  };
}

/**
 * Address of a list page: the path plus the parameters that differ from the defaults, so the
 * first page of the default order has the plain path. Built with `URLSearchParams`, which encodes
 * every value; `basePath` is a fixed in-app path built by the caller.
 */
export function listHref(basePath: string, params: ListHrefParams, page: number): string {
  const search = new URLSearchParams();
  if (params.q !== undefined && params.q !== "") search.set("q", params.q);
  if (params.category !== undefined && params.category !== "")
    search.set("category", params.category);
  if (params.minPriceSatang !== undefined) {
    search.set("minPriceSatang", String(params.minPriceSatang));
  }
  if (params.maxPriceSatang !== undefined) {
    search.set("maxPriceSatang", String(params.maxPriceSatang));
  }
  if (params.sort !== undefined && params.sort !== DEFAULT_PRODUCT_SORT) {
    search.set("sort", params.sort);
  }
  if (Number.isSafeInteger(page) && page > 1) search.set("page", String(page));
  const text = search.toString();
  return text === "" ? basePath : `${basePath}?${text}`;
}
