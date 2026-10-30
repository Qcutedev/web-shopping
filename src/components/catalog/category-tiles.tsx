import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { listAllActiveCategories } from "@/components/catalog/all-categories";
import { ProductImage } from "@/components/catalog/product-image";
import { Skeleton } from "@/components/ui/skeleton";
import { th } from "@/i18n/th";
import { categoryHref } from "@/lib/routes";
import { listProducts } from "@/modules/catalog";
import type { CategoryDto, ImageRef } from "@/modules/catalog/schema";

const MAX_TILES = 8;
const TILE_LIST = "grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-3";

export interface CategoryTile {
  category: CategoryDto;
  image: ImageRef | null;
}

/** Category cards: the picture of the category's newest product over its name. */
export function CategoryTilesView({ tiles }: { tiles: readonly CategoryTile[] }) {
  if (tiles.length === 0) return null;
  return (
    <nav aria-label={th.catalog.categories.label}>
      <ul className={TILE_LIST}>
        {tiles.map(({ category, image }) => (
          <li key={category.id}>
            <Link
              href={categoryHref(category.slug)}
              className="group focus-ring flex flex-col items-center gap-2 rounded-lg text-center"
            >
              <ProductImage
                image={image}
                alt=""
                sizes="(min-width: 1024px) 12vw, 25vw"
                className="transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-md"
              />
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

/**
 * Server Component. Categories are navigation: if they fail to load, nothing is shown. A category
 * whose newest product cannot be read keeps its card without a picture.
 */
export async function CategoryTiles() {
  await connection();
  let categories: CategoryDto[];
  try {
    categories = (await listAllActiveCategories()).slice(0, MAX_TILES);
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
  const tiles = await Promise.all(
    categories.map(async (category): Promise<CategoryTile> => {
      try {
        const page = await listProducts({
          page: 1,
          pageSize: 1,
          sort: "newest",
          category: category.slug,
        });
        return { category, image: page.items[0]?.image ?? null };
      } catch (error) {
        unstable_rethrow(error);
        return { category, image: null };
      }
    }),
  );
  return <CategoryTilesView tiles={tiles} />;
}
