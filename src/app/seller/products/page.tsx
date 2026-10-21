import type { Metadata } from "next";
import { Suspense } from "react";
import { SellerSkeleton } from "@/components/seller/load-state";
import { ProductsSection } from "@/components/seller/products-section";
import { SellerFrame } from "@/components/seller/seller-frame";
import { th } from "@/i18n/th";

export const metadata: Metadata = {
  title: th.seller.products.title,
  robots: { index: false, follow: false },
};

export default function SellerProductsPage({ searchParams }: PageProps<"/seller/products">) {
  return (
    <SellerFrame
      current="products"
      title={th.seller.products.title}
      description={th.seller.products.description}
    >
      <Suspense fallback={<SellerSkeleton rows={3} />}>
        <ProductsSection searchParams={searchParams} />
      </Suspense>
    </SellerFrame>
  );
}
