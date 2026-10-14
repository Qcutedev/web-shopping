import type { Metadata } from "next";
import { Suspense } from "react";
import { CatalogInvalidFilter } from "@/components/catalog/catalog-load-error";
import { hrefParamsOf, listHref } from "@/components/catalog/list-href";
import { parseListQuery } from "@/components/catalog/list-query";
import { ProductGridSkeleton } from "@/components/catalog/product-grid";
import { ProductListSection } from "@/components/catalog/product-list-section";
import { SearchHeading } from "@/components/catalog/search-heading";
import { SortLinks } from "@/components/catalog/sort-links";
import { th } from "@/i18n/th";
import { ROUTES } from "@/lib/routes";
import { listProducts } from "@/modules/catalog";

export const metadata: Metadata = { title: th.catalog.search.title };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="container-page flex flex-col gap-6 py-8">
      <Suspense fallback={<ProductGridSkeleton />}>
        <SearchContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function SearchContent({ searchParams }: { searchParams: SearchParams }) {
  const query = parseListQuery(await searchParams);
  if (query === null) {
    return (
      <>
        <h1 className="type-page-title">{th.catalog.search.title}</h1>
        <CatalogInvalidFilter resetHref={ROUTES.search} />
      </>
    );
  }
  const params = hrefParamsOf(query);
  const self = listHref(ROUTES.search, params, query.page);
  return (
    <>
      <SearchHeading q={query.q} />
      <SortLinks
        current={query.sort}
        hrefForSort={(sort) => listHref(ROUTES.search, hrefParamsOf(query, { sort }), 1)}
      />
      <ProductListSection
        load={() => listProducts(query)}
        hrefForPage={(page) => listHref(ROUTES.search, params, page)}
        retryHref={self}
        showCount
        empty={{
          title: th.catalog.search.emptyTitle,
          description: th.catalog.search.emptyDescription,
          action: { href: ROUTES.home, label: th.notFound.backHome },
        }}
      />
    </>
  );
}
