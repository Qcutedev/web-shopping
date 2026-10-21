import { listCategories } from "@/modules/catalog";
import { type CategoryDto, MAX_PAGE_SIZE } from "@/modules/catalog/schema";

/** Upper bound on requests, so a misbehaving total can never loop forever (50 x 20 = 1000 rows). */
export const MAX_CATEGORY_PAGES = 20;

/**
 * Every active category, read page by page (CR-100). `listCategories` is paged, so reading only
 * page 1 hides the categories after the 50th from the chips, the search filter, and the seller's
 * product form. Stops when the service's `total` is reached or a page comes back empty.
 */
export async function listAllActiveCategories(): Promise<CategoryDto[]> {
  const all: CategoryDto[] = [];
  for (let page = 1; page <= MAX_CATEGORY_PAGES; page += 1) {
    const result = await listCategories({ page, pageSize: MAX_PAGE_SIZE });
    all.push(...result.items);
    if (result.items.length === 0 || all.length >= result.total) break;
  }
  return all;
}
