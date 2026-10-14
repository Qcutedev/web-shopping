import { notFound, unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { CatalogLoadError } from "@/components/catalog/catalog-load-error";
import { type ListEmpty, ProductListView } from "@/components/catalog/product-list-view";
import { isAppError } from "@/server/errors";
import type { Page, ProductListItemDto } from "@/modules/catalog/schema";

/**
 * Server Component: loads one page of products through a catalog service function and renders
 * the success, empty, or error state. Render it behind a Suspense boundary (the loading state).
 * `connection()` keeps the read out of the build-time prerender (T-004 finding V3).
 *
 * A 404 from the service (unknown category or store, BR-05) becomes the not-found page; any other
 * failure becomes the error state with a retry link. Nothing from the error is shown.
 */
export async function ProductListSection({
  load,
  hrefForPage,
  retryHref,
  empty,
  showCount,
  heading,
}: {
  load: () => Promise<Page<ProductListItemDto>>;
  hrefForPage: (page: number) => string;
  retryHref: string;
  empty: ListEmpty;
  showCount?: boolean;
  heading?: ReactNode;
}) {
  await connection();
  let data: Page<ProductListItemDto>;
  try {
    data = await load();
  } catch (error) {
    unstable_rethrow(error);
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    return <CatalogLoadError retryHref={retryHref} />;
  }
  return (
    <ProductListView
      data={data}
      hrefForPage={hrefForPage}
      empty={empty}
      showCount={showCount}
      heading={heading}
    />
  );
}
