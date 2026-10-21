import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardSection } from "@/components/seller/dashboard-section";
import { SellerSkeleton } from "@/components/seller/load-state";
import { SellerFrame } from "@/components/seller/seller-frame";
import { th } from "@/i18n/th";

export const metadata: Metadata = {
  title: th.seller.dashboard.title,
  robots: { index: false, follow: false },
};

export default function SellerDashboardPage() {
  return (
    <SellerFrame
      current="dashboard"
      title={th.seller.dashboard.title}
      description={th.seller.dashboard.description}
    >
      <Suspense fallback={<SellerSkeleton rows={3} />}>
        <DashboardSection />
      </Suspense>
    </SellerFrame>
  );
}
