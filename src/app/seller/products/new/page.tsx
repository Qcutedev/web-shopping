import type { Metadata } from "next";
import { Suspense } from "react";
import { SellerSkeleton } from "@/components/seller/load-state";
import { NewProductSection } from "@/components/seller/product-sections";
import { SellerFrame } from "@/components/seller/seller-frame";
import { th } from "@/i18n/th";

export const metadata: Metadata = {
  title: th.seller.products.newTitle,
  robots: { index: false, follow: false },
};

export default function SellerNewProductPage() {
  return (
    <SellerFrame
      current="products"
      title={th.seller.products.newTitle}
      description={th.seller.products.newDescription}
    >
      <Suspense fallback={<SellerSkeleton />}>
        <NewProductSection />
      </Suspense>
    </SellerFrame>
  );
}
