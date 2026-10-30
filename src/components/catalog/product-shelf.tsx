import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { listAllActiveCategories } from "@/components/catalog/all-categories";
import { ProductCard } from "@/components/catalog/product-card";
import { ScrollRow, ScrollRowItem } from "@/components/scroll-row";
import { ChevronRightIcon } from "@/components/ui/icons";
import { Reveal } from "@/components/reveal";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { categoryHref, ROUTES } from "@/lib/routes";
import { listProducts } from "@/modules/catalog";
import type { CategoryDto, Page, ProductListItemDto } from "@/modules/catalog/schema";

const SHELF_SIZE = 10;
const SHELF_CATEGORIES = 3;

const SEE_ALL =
  "type-label text-foreground hover:text-primary focus-ring inline-flex min-h-11 items-center gap-1 rounded-sm";

/** A short row of products with a heading and an "all" link. Renders nothing when it is empty. */
export function ProductShelf({
  id,
  title,
  href,
  products,
}: {
  id: string;
  title: string;
  href: string;
  products: readonly ProductListItemDto[];
}) {
  if (products.length === 0) return null;
  return (
    <Reveal>
      <section
        aria-labelledby={id}
        className="bg-surface-muted flex flex-col gap-4 rounded-xl p-4 md:p-6"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id={id} className="type-section-title">
            {title}
          </h2>
          <Link href={href} className={SEE_ALL}>
            {th.catalog.home.viewAllArrow}
            <ChevronRightIcon />
          </Link>
        </div>
        <ScrollRow
          label={title}
          previous={th.catalog.home.scrollPrevious}
          next={th.catalog.home.scrollNext}
        >
          {products.map((product, index) => (
            <ScrollRowItem key={product.id}>
              <ProductCard product={product} priority={index < 4} />
            </ScrollRowItem>
          ))}
        </ScrollRow>
      </section>
    </Reveal>
  );
}

/** Lowest-priced products. Server Component; a failed read shows nothing (the page has more). */
export async function CheapestShelf() {
  await connection();
  let products: ProductListItemDto[];
  try {
    products = (await listProducts({ page: 1, pageSize: SHELF_SIZE, sort: "price_asc" })).items;
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
  return (
    <ProductShelf
      id="home-cheapest"
      title={th.catalog.home.cheapestTitle}
      href={`${ROUTES.search}?sort=price_asc`}
      products={products}
    />
  );
}

/** One shelf for each of the first categories that has products. */
export async function CategoryShelves() {
  await connection();
  let categories: CategoryDto[];
  let pages: Page<ProductListItemDto>[];
  try {
    categories = (await listAllActiveCategories()).slice(0, SHELF_CATEGORIES);
    pages = await Promise.all(
      categories.map((category) =>
        listProducts({ page: 1, pageSize: SHELF_SIZE, sort: "newest", category: category.slug }),
      ),
    );
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
  return (
    <>
      {categories.map((category, i) => (
        <ProductShelf
          key={category.id}
          id={`home-shelf-${category.id}`}
          title={fill(th.catalog.home.categoryShelf, { name: category.name })}
          href={categoryHref(category.slug)}
          products={pages[i]?.items ?? []}
        />
      ))}
    </>
  );
}
