import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminFrame } from "@/components/admin/admin-frame";
import { AdminSkeleton } from "@/components/admin/load-state";
import { OrderSection } from "@/components/admin/order-section";
import { th } from "@/i18n/th";

export const metadata: Metadata = {
  title: th.admin.orders.detailTitle,
  robots: { index: false, follow: false },
};

export default function OrderPage({ params }: PageProps<"/admin/orders/[id]">) {
  return (
    <AdminFrame current="orders" title={th.admin.orders.detailTitle}>
      <Suspense fallback={<AdminSkeleton rows={3} />}>
        <OrderSection params={params} />
      </Suspense>
    </AdminFrame>
  );
}
