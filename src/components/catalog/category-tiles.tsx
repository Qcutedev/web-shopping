import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { listAllActiveCategories } from "@/components/catalog/all-categories";
import { CategoryIcon } from "@/components/catalog/category-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { th } from "@/i18n/th";
import { categoryHref } from "@/lib/routes";
import type { CategoryDto } from "@/modules/catalog/schema";

const MAX_TILES = 12;
const TILE_LIST = "grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-3";

/** Category cards: a line icon on a tinted disc over the category's name. */
export function CategoryTilesView({ categories }: { categories: readonly CategoryDto[] }) {
  if (categories.length === 0) return null;
  return (
    <nav aria-label={th.catalog.categories.label}>
      <ul className={TILE_LIST}>
        {categories.map((category, i) => (
          <li key={category.id}>
            <Link
              href={categoryHref(category.slug)}
              className="group focus-ring flex flex-col items-center gap-2 rounded-lg text-center"
            >
              <span
                aria-hidden="true"
                data-tone={i % 5}
                className="category-disc flex aspect-square w-full items-center justify-center rounded-lg transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-md"
              >
                <CategoryIcon
                  name={category.name}
                  className="size-10 transition-transform duration-300 group-hover:scale-110"
                />
              </span>
              <span className="type-label text-foreground line-clamp-2 group-hover:underline">
                {category.name}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function CategoryTilesSkeleton() {
  return (
    <div aria-hidden="true" className={TILE_LIST}>
      {Array.from({ length: MAX_TILES }, (_, index) => (
        <div key={index} className="flex flex-col items-center gap-2">
          <Skeleton className="aspect-square w-full rounded-lg" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ))}
    </div>
  );
}

/** Server Component. Categories are navigation: if they fail to load, nothing is shown. */
export async function CategoryTiles() {
  await connection();
  let categories: CategoryDto[];
  try {
    categories = (await listAllActiveCategories()).slice(0, MAX_TILES);
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
  return <CategoryTilesView categories={categories} />;
}
