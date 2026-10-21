import type { Metadata } from "next";
import { Suspense } from "react";
import { SellerSkeleton } from "@/components/seller/load-state";
import { ProductDetailSection } from "@/components/seller/product-sections";
import { SellerFrame } from "@/components/seller/seller-frame";
import { th } from "@/i18n/th";

export const metadata: Metadata = {
  title: th.seller.products.detailTitle,
  robots: { index: false, follow: false },
};

export default function SellerProductPage({
  params,
  searchParams,
}: PageProps<"/seller/products/[id]">) {
  return (
    <SellerFrame current="products" title={th.seller.products.detailTitle}>
      <Suspense fallback={<SellerSkeleton rows={3} />}>
        <ProductDetailSection params={params} searchParams={searchParams} />
      </Suspense>
    </SellerFrame>
  );
}
