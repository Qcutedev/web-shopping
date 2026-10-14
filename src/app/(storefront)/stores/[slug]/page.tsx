import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CatalogInvalidFilter } from "@/components/catalog/catalog-load-error";
import { applyPriceFilter } from "@/components/catalog/price-filter";
import { parseListQuery } from "@/components/catalog/list-query";
import { ProductGridSkeleton } from "@/components/catalog/product-grid";
import { StoreSection } from "@/components/catalog/store-section";
import { storeHref } from "@/lib/routes";
import { slugParamsSchema } from "@/modules/catalog/schema";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Params = Promise<{ slug: string }>;

export default function StorePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  return (
    <div className="container-page py-8">
      <Suspense fallback={<ProductGridSkeleton />}>
        <StoreContent params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function StoreContent({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const parsed = slugParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  const price = applyPriceFilter(await searchParams);
  const query = parseListQuery(price.raw);
  if (query === null) return <CatalogInvalidFilter resetHref={storeHref(parsed.data.slug)} />;
  return (
    <StoreSection
      slug={parsed.data.slug}
      query={query}
      filter={{ minText: price.minText, maxText: price.maxText, errors: price.errors }}
    />
  );
}
