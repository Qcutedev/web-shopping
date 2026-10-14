import { DEFAULT_PRODUCT_SORT, type ProductSort } from "@/modules/catalog/schema";

export interface ListHrefParams {
  q?: string | undefined;
  sort?: ProductSort | undefined;
}

/**
 * Address of a list page: the path plus the parameters that differ from the defaults, so the
 * first page of the default order has the plain path. Built with `URLSearchParams`, which encodes
 * every value; `basePath` is a fixed in-app path built by the caller.
 */
export function listHref(basePath: string, params: ListHrefParams, page: number): string {
  const search = new URLSearchParams();
  if (params.q !== undefined && params.q !== "") search.set("q", params.q);
  if (params.sort !== undefined && params.sort !== DEFAULT_PRODUCT_SORT) {
    search.set("sort", params.sort);
  }
  if (Number.isSafeInteger(page) && page > 1) search.set("page", String(page));
  const text = search.toString();
  return text === "" ? basePath : `${basePath}?${text}`;
}
