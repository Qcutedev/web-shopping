import type { Metadata } from "next";
import { Suspense } from "react";
import { SellerSkeleton } from "@/components/seller/load-state";
import { OrderSection } from "@/components/seller/order-section";
import { SellerFrame } from "@/components/seller/seller-frame";
import { th } from "@/i18n/th";

export const metadata: Metadata = {
  title: th.seller.orders.detailTitle,
  robots: { index: false, follow: false },
};

export default function SellerOrderPage({ params }: PageProps<"/seller/orders/[id]">) {
  return (
    <SellerFrame current="orders" title={th.seller.orders.detailTitle}>
      <Suspense fallback={<SellerSkeleton rows={3} />}>
        <OrderSection params={params} />
      </Suspense>
    </SellerFrame>
  );
}
