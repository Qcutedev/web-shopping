import type { Metadata } from "next";
import { Suspense } from "react";
import { SellerSkeleton } from "@/components/seller/load-state";
import { SellerFrame } from "@/components/seller/seller-frame";
import { StoreSection } from "@/components/seller/store-section";
import { th } from "@/i18n/th";

export const metadata: Metadata = {
  title: th.seller.store.title,
  robots: { index: false, follow: false },
};

export default function SellerStorePage() {
  return (
    <SellerFrame
      current="store"
      title={th.seller.store.title}
      description={th.seller.store.description}
    >
      <Suspense fallback={<SellerSkeleton />}>
        <StoreSection />
      </Suspense>
    </SellerFrame>
  );
}
