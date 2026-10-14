import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CatalogInvalidFilter } from "@/components/catalog/catalog-load-error";
import { CategoryChips, CategoryChipsSkeleton } from "@/components/catalog/category-chips";
import { hrefParamsOf, listHref } from "@/components/catalog/list-href";
import { FilterForm } from "@/components/catalog/filter-form";
import { applyPriceFilter } from "@/components/catalog/price-filter";
import { parseListQuery } from "@/components/catalog/list-query";
import { ProductGridSkeleton } from "@/components/catalog/product-grid";
import { ProductListSection } from "@/components/catalog/product-list-section";
import { SortLinks } from "@/components/catalog/sort-links";
import { th } from "@/i18n/th";
import { categoryHref, ROUTES } from "@/lib/routes";
import { listProducts } from "@/modules/catalog";
import { slugParamsSchema } from "@/modules/catalog/schema";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Params = Promise<{ slug: string }>;

export default function CategoryPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  return (
    <div className="container-page flex flex-col gap-6 py-8">
      <h1 className="type-page-title">{th.catalog.categories.label}</h1>
      <Suspense fallback={<ProductGridSkeleton />}>
        <CategoryContent params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function CategoryContent({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const parsedSlug = slugParamsSchema.safeParse(await params);
  if (!parsedSlug.success) notFound();
  const slug = parsedSlug.data.slug;
  const price = applyPriceFilter(await searchParams);
  const query = parseListQuery(price.raw, { category: slug });
  if (query === null) return <CatalogInvalidFilter resetHref={categoryHref(slug)} />;

  const base = categoryHref(slug);
  // The category is in the path; every other filter rides in the query string.
  const sortParams = hrefParamsOf(query, { category: undefined });
  return (
    <>
      <Suspense fallback={<CategoryChipsSkeleton />}>
        <CategoryChips currentSlug={slug} />
      </Suspense>
      <FilterForm
        action={base}
        resetHref={listHref(base, { q: sortParams.q, sort: query.sort }, 1)}
        q={query.q}
        sort={query.sort}
        minText={price.minText}
        maxText={price.maxText}
        errors={price.errors}
      />
      <SortLinks
        current={query.sort}
        hrefForSort={(sort) => listHref(base, { ...sortParams, sort }, 1)}
      />
      <ProductListSection
        load={() => listProducts(query)}
        hrefForPage={(page) => listHref(base, sortParams, page)}
        retryHref={listHref(base, sortParams, query.page)}
        showCount
        empty={{
          title: th.catalog.category.emptyTitle,
          description: th.catalog.category.emptyDescription,
          action: { href: ROUTES.search, label: th.catalog.home.viewAll },
        }}
      />
    </>
  );
}
