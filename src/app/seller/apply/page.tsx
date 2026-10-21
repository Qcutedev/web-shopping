import type { Metadata } from "next";
import { Suspense } from "react";
import { ApplySection } from "@/components/seller/apply-section";
import { SellerSkeleton } from "@/components/seller/load-state";
import { SellerFrame } from "@/components/seller/seller-frame";
import { th } from "@/i18n/th";

// A personal page: kept out of search results.
export const metadata: Metadata = {
  title: th.seller.apply.title,
  robots: { index: false, follow: false },
};

// The session is read behind the boundary, so the frame and the skeleton are in the static shell.
export default function SellerApplyPage() {
  return (
    <SellerFrame title={th.seller.apply.title} description={th.seller.apply.description}>
      <Suspense fallback={<SellerSkeleton />}>
        <ApplySection />
      </Suspense>
    </SellerFrame>
  );
}
