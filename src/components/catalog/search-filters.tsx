import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { FilterForm } from "@/components/catalog/filter-form";
import type { PriceFilterError } from "@/components/catalog/price-filter";
import { listAllActiveCategories } from "@/components/catalog/all-categories";
import type { CategoryDto, ProductSort } from "@/modules/catalog/schema";

export { FilterFormSkeleton } from "@/components/catalog/filter-form";

/**
 * Server Component: the search page's filter form with the category select. Categories are a
 * convenience; if they fail to load the price filter is still shown, without the select.
 */
export async function SearchFilters(props: {
  action: string;
  resetHref: string;
  q?: string | undefined;
  sort: ProductSort;
  minText: string;
  maxText: string;
  errors: readonly PriceFilterError[];
  category?: string | undefined;
}) {
  await connection();
  let categories: CategoryDto[] = [];
  try {
    categories = await listAllActiveCategories();
  } catch (error) {
    unstable_rethrow(error);
  }
  return <FilterForm {...props} categories={categories} />;
}
