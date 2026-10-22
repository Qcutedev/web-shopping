import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountSkeleton } from "@/components/account/load-state";
import { OrderSection } from "@/components/orders/order-section";
import { PageFrame } from "@/components/page-frame";
import { th } from "@/i18n/th";

export const metadata: Metadata = {
  title: th.orders.detailTitle,
  robots: { index: false, follow: false },
};

export default function OrderPage({ params }: PageProps<"/orders/[id]">) {
  return (
    <PageFrame heading={th.orders.detailTitle}>
      <Suspense fallback={<AccountSkeleton rows={3} />}>
        <OrderContent params={params} />
      </Suspense>
    </PageFrame>
  );
}

async function OrderContent({ params }: Pick<PageProps<"/orders/[id]">, "params">) {
  const { id } = await params;
  return <OrderSection id={id} />;
}
