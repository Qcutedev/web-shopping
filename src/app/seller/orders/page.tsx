import type { Metadata } from "next";
import { Suspense } from "react";
import { SellerSkeleton } from "@/components/seller/load-state";
import { OrdersSection } from "@/components/seller/orders-section";
import { SellerFrame } from "@/components/seller/seller-frame";
import { th } from "@/i18n/th";

export const metadata: Metadata = {
  title: th.seller.orders.title,
  robots: { index: false, follow: false },
};

export default function SellerOrdersPage({ searchParams }: PageProps<"/seller/orders">) {
  return (
    <SellerFrame
      current="orders"
      title={th.seller.orders.title}
      description={th.seller.orders.description}
    >
      <Suspense fallback={<SellerSkeleton rows={3} />}>
        <OrdersSection searchParams={searchParams} />
      </Suspense>
    </SellerFrame>
  );
}
