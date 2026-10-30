import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { listAllActiveCategories } from "@/components/catalog/all-categories";
import { Skeleton } from "@/components/ui/skeleton";
import type { CategoryDto } from "@/modules/catalog/schema";
import { CategoryDrawer } from "./category-drawer";

/** Server Component. If categories fail to load the menu still opens, with the fixed links only. */
export async function HeaderCategoryMenu() {
  await connection();
  let categories: CategoryDto[] = [];
  try {
    categories = await listAllActiveCategories();
  } catch (error) {
    unstable_rethrow(error);
  }
  return (
    <CategoryDrawer categories={categories.map(({ id, name, slug }) => ({ id, name, slug }))} />
  );
}

export function HeaderCategoryMenuSkeleton() {
  return <Skeleton aria-hidden="true" className="size-11 rounded-md" />;
}
