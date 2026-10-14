import Image from "next/image";
import { notFound, unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { CatalogLoadError } from "@/components/catalog/catalog-load-error";
import { FilterForm } from "@/components/catalog/filter-form";
import type { PriceFilterError } from "@/components/catalog/price-filter";
import { hrefParamsOf, listHref } from "@/components/catalog/list-href";
import { ProductListSection } from "@/components/catalog/product-list-section";
import { SortLinks } from "@/components/catalog/sort-links";
import { NoticeLabel } from "@/components/ui/notice-label";
import { UserName, USER_NAME_CONTAINER_CLASS } from "@/components/user-name";
import { th } from "@/i18n/th";
import { ROUTES, storeHref } from "@/lib/routes";
import { getStore, listStoreProducts } from "@/modules/catalog";
import type { ListProductsQuery, StoreDto } from "@/modules/catalog/schema";
import { isAppError } from "@/server/errors";

/** What the price filter form shows: the baht text as typed and any problems with it. */
export interface StoreFilterState {
  minText: string;
  maxText: string;
  errors: readonly PriceFilterError[];
}

/** Server Component: a public store and its visible products. Not public: the not-found page. */
export async function StoreSection({
  slug,
  query,
  filter,
}: {
  slug: string;
  query: ListProductsQuery;
  filter?: StoreFilterState;
}) {
  await connection();
  let store: StoreDto;
  try {
    store = await getStore(slug);
  } catch (error) {
    unstable_rethrow(error);
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    return <CatalogLoadError retryHref={storeHref(slug)} />;
  }
  return <StoreView store={store} query={query} filter={filter} />;
}

/** Store header, order links, and the product list. The logo is decorative: the name sits beside it. */
export function StoreView({
  store,
  query,
  filter = { minText: "", maxText: "", errors: [] },
}: {
  store: StoreDto;
  query: ListProductsQuery;
  filter?: StoreFilterState | undefined;
}) {
  const base = storeHref(store.slug);
  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start gap-4">
        <div className="bg-surface-muted relative size-16 shrink-0 overflow-hidden rounded-lg md:size-20">
          {store.logo === null ? null : (
            <Image
              src={store.logo.url}
              alt=""
              fill
              sizes="80px"
              unoptimized
              className="object-cover"
            />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className={`type-page-title ${USER_NAME_CONTAINER_CLASS}`}>
            <UserName>{store.name}</UserName>
          </h1>
          {store.isSample ? (
            <span>
              <NoticeLabel>{th.notice.sampleData}</NoticeLabel>
            </span>
          ) : null}
          {store.description !== null ? (
            <p className="type-body text-foreground-secondary [overflow-wrap:anywhere] whitespace-pre-line">
              {store.description}
            </p>
          ) : null}
        </div>
      </header>
      <SortLinks
        current={query.sort}
        hrefForSort={(sort) => listHref(base, hrefParamsOf(query, { sort }), 1)}
      />
      <FilterForm
        action={base}
        resetHref={listHref(base, { q: query.q, sort: query.sort, category: query.category }, 1)}
        q={query.q}
        sort={query.sort}
        category={query.category}
        minText={filter.minText}
        maxText={filter.maxText}
        errors={filter.errors}
      />
      <ProductListSection
        load={() => listStoreProducts(store.slug, query)}
        hrefForPage={(page) => listHref(base, hrefParamsOf(query), page)}
        retryHref={listHref(base, hrefParamsOf(query), query.page)}
        showCount
        empty={{
          title: th.catalog.store.emptyTitle,
          description: th.catalog.store.emptyDescription,
          action: { href: ROUTES.home, label: th.notFound.backHome },
        }}
      />
    </div>
  );
}
