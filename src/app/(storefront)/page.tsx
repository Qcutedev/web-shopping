import Link from "next/link";
import { Suspense } from "react";
import { CategoryChips, CategoryChipsSkeleton } from "@/components/catalog/category-chips";
import { listHref } from "@/components/catalog/list-href";
import { ProductGridSkeleton } from "@/components/catalog/product-grid";
import { ProductListSection } from "@/components/catalog/product-list-section";
import { buttonVariants } from "@/components/ui/button";
import { th } from "@/i18n/th";
import { ROUTES } from "@/lib/routes";
import { listProducts } from "@/modules/catalog";
import { DEFAULT_PAGE_SIZE } from "@/modules/catalog/schema";

// The product list and the categories read the catalog at request time, behind Suspense; the
// headings and skeletons are in the static shell.
export default function HomePage() {
  return (
    <div className="container-page flex flex-col gap-8 py-8">
      <section aria-labelledby="home-categories" className="flex flex-col gap-3">
        <h2 id="home-categories" className="type-section-title">
          {th.catalog.home.categoriesTitle}
        </h2>
        <Suspense fallback={<CategoryChipsSkeleton />}>
          <CategoryChips />
        </Suspense>
      </section>
      <section aria-labelledby="home-newest" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 id="home-newest" className="type-page-title">
            {th.catalog.home.newestTitle}
          </h1>
          <Link href={ROUTES.search} className={buttonVariants({ variant: "secondary" })}>
            {th.catalog.home.viewAll}
          </Link>
        </div>
        <Suspense fallback={<ProductGridSkeleton />}>
          <ProductListSection
            load={() => listProducts({ page: 1, pageSize: DEFAULT_PAGE_SIZE, sort: "newest" })}
            hrefForPage={(page) => listHref(ROUTES.search, {}, page)}
            retryHref={ROUTES.home}
            empty={{
              title: th.catalog.home.emptyTitle,
              description: th.catalog.home.emptyDescription,
              action: { href: ROUTES.search, label: th.catalog.home.viewAll },
            }}
          />
        </Suspense>
      </section>
    </div>
  );
}
