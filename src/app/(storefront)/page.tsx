import Link from "next/link";
import { Suspense } from "react";
import { CategoryMenu, CategoryMenuSkeleton } from "@/components/catalog/category-menu";
import { CategoryTiles, CategoryTilesSkeleton } from "@/components/catalog/category-tiles";
import { FeaturedStores } from "@/components/catalog/featured-stores";
import { PromoBanners, SideBanners } from "@/components/catalog/home-banners";
import { HeroSection, HeroSkeleton } from "@/components/catalog/hero-section";
import { CategoryShelves, CheapestShelf } from "@/components/catalog/product-shelf";
import { Reveal } from "@/components/reveal";
import { HomeHighlights } from "@/components/catalog/home-highlights";
import { listHref } from "@/components/catalog/list-href";
import { ProductGridSkeleton } from "@/components/catalog/product-grid";
import { ProductListSection } from "@/components/catalog/product-list-section";
import { ChevronRightIcon } from "@/components/ui/icons";
import { th } from "@/i18n/th";
import { ROUTES } from "@/lib/routes";
import { listProducts } from "@/modules/catalog";
import { DEFAULT_PAGE_SIZE } from "@/modules/catalog/schema";

const SEE_ALL =
  "type-label text-foreground hover:text-primary focus-ring inline-flex min-h-11 items-center gap-1 rounded-sm";

// The poster, the category cards and the product list read the catalog at request time, behind
// Suspense; the headings and skeletons are in the static shell.
export default function HomePage() {
  return (
    <div className="container-page flex flex-col gap-10 py-6 md:py-8">
      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_16rem]">
        <Suspense fallback={<CategoryMenuSkeleton />}>
          <CategoryMenu />
        </Suspense>
        <Suspense fallback={<HeroSkeleton />}>
          <HeroSection />
        </Suspense>
        <div className="lg:col-span-2 xl:col-span-1 xl:h-full">
          <SideBanners
            targets={[
              { href: ROUTES.search, tone: 0 },
              { href: ROUTES.openStore, tone: 3 },
            ]}
          />
        </div>
      </div>
      <Reveal>
        <HomeHighlights />
      </Reveal>
      <PromoBanners
        targets={[
          { href: `${ROUTES.search}?sort=price_asc`, tone: 1 },
          { href: ROUTES.search, tone: 2 },
          { href: "#home-stores", tone: 4 },
        ]}
      />
      <section
        aria-labelledby="home-categories"
        className="page-rise flex flex-col gap-4 lg:hidden"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="home-categories" className="type-section-title">
            {th.catalog.home.categoriesTitle}
          </h2>
          <Link href={ROUTES.search} className={SEE_ALL}>
            {th.catalog.home.viewAllArrow}
            <ChevronRightIcon />
          </Link>
        </div>
        <Suspense fallback={<CategoryTilesSkeleton />}>
          <CategoryTiles />
        </Suspense>
      </section>
      <section aria-labelledby="home-newest" className="page-rise flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 id="home-newest" className="type-section-title">
            {th.catalog.home.newestTitle}
          </h1>
          <Link href={ROUTES.search} className={SEE_ALL}>
            {th.catalog.home.viewAll}
            <ChevronRightIcon />
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
      <Suspense fallback={null}>
        <FeaturedStores />
      </Suspense>
      <Suspense fallback={null}>
        <CheapestShelf />
      </Suspense>
      <Suspense fallback={null}>
        <CategoryShelves />
      </Suspense>
    </div>
  );
}
