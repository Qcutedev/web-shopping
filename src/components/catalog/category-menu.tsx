import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { listAllActiveCategories } from "@/components/catalog/all-categories";
import { CategoryIcon } from "@/components/catalog/category-icon";
import { ChevronRightIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { th } from "@/i18n/th";
import { categoryHref, ROUTES } from "@/lib/routes";
import type { CategoryDto } from "@/modules/catalog/schema";

const MENU_ITEMS = 9;

const MENU_LINK =
  "focus-ring text-foreground hover:bg-surface-muted hover:text-primary flex min-h-11 items-center gap-3 rounded-md px-3 transition-colors duration-150";

/** Category list for the left of the poster. Shown from the large breakpoint up. */
export function CategoryMenuView({ categories }: { categories: readonly CategoryDto[] }) {
  if (categories.length === 0) return null;
  return (
    <nav
      aria-label={th.catalog.home.menuTitle}
      className="border-border bg-surface hidden rounded-xl border p-2 lg:block"
    >
      <p className="type-label text-foreground-muted px-3 py-2">{th.catalog.home.menuTitle}</p>
      <ul>
        {categories.slice(0, MENU_ITEMS).map((category) => (
          <li key={category.id}>
            <Link href={categoryHref(category.slug)} className={MENU_LINK}>
              <CategoryIcon name={category.name} className="size-5 shrink-0" />
              <span className="type-small line-clamp-1 flex-1">{category.name}</span>
              <ChevronRightIcon className="text-foreground-muted size-4" />
            </Link>
          </li>
        ))}
        <li>
          <Link href={ROUTES.search} className={`${MENU_LINK} type-small font-medium`}>
            {th.catalog.home.menuAllProducts}
          </Link>
        </li>
      </ul>
    </nav>
  );
}

export function CategoryMenuSkeleton() {
  return <Skeleton aria-hidden="true" className="hidden h-96 rounded-xl lg:block" />;
}

/** Server Component. Navigation only: if categories fail to load, nothing is shown. */
export async function CategoryMenu() {
  await connection();
  let categories: CategoryDto[];
  try {
    categories = await listAllActiveCategories();
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
  return <CategoryMenuView categories={categories} />;
}
