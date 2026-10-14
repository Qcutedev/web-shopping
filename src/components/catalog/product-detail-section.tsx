import { notFound, unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CatalogLoadError } from "@/components/catalog/catalog-load-error";
import { ProductDetailView } from "@/components/catalog/product-detail-view";
import { ReviewsSection } from "@/components/catalog/reviews-section";
import { Skeleton } from "@/components/ui/skeleton";
import { productHref } from "@/lib/routes";
import { getProduct } from "@/modules/catalog";
import type { ProductDetailDto } from "@/modules/catalog/schema";
import { isAppError } from "@/server/errors";

/**
 * Server Component. A product that is hidden or does not exist is the not-found page (BR-05);
 * the service answers both alike.
 */
export async function ProductDetailSection({ slug }: { slug: string }) {
  await connection();
  let product: ProductDetailDto;
  try {
    product = await getProduct(slug);
  } catch (error) {
    unstable_rethrow(error);
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    return <CatalogLoadError retryHref={productHref(slug)} />;
  }
  return (
    <div className="flex flex-col gap-10">
      <ProductDetailView product={product} />
      <Suspense fallback={<Skeleton className="h-24 w-full" />}>
        <ReviewsSection slug={product.slug} />
      </Suspense>
    </div>
  );
}
