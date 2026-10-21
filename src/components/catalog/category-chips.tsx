import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { CategoryChipsView } from "@/components/catalog/category-chips-view";
import { listAllActiveCategories } from "@/components/catalog/all-categories";
import type { CategoryDto } from "@/modules/catalog/schema";

export { CategoryChipsSkeleton } from "@/components/catalog/category-chips-view";

/**
 * Server Component. Categories are navigation, not the point of the page: if they fail to load
 * the page still works, so a failure renders nothing instead of an error.
 */
export async function CategoryChips({ currentSlug }: { currentSlug?: string }) {
  await connection();
  let categories: CategoryDto[];
  try {
    categories = await listAllActiveCategories();
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
  return <CategoryChipsView categories={categories} currentSlug={currentSlug} />;
}
