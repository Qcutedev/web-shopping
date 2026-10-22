import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountSkeleton } from "@/components/account/load-state";
import { OrdersSection } from "@/components/orders/orders-section";
import { PageFrame } from "@/components/page-frame";
import { th } from "@/i18n/th";

export const metadata: Metadata = {
  title: th.orders.title,
  robots: { index: false, follow: false },
};

export default function OrdersPage({ searchParams }: PageProps<"/orders">) {
  return (
    <PageFrame heading={th.orders.title} description={th.orders.description}>
      <Suspense fallback={<AccountSkeleton rows={3} />}>
        <OrdersSection searchParams={searchParams} />
      </Suspense>
    </PageFrame>
  );
}
