import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminFrame } from "@/components/admin/admin-frame";
import { AdminSkeleton } from "@/components/admin/load-state";
import { OrdersSection } from "@/components/admin/orders-section";
import { th } from "@/i18n/th";

export const metadata: Metadata = {
  title: th.admin.orders.title,
  robots: { index: false, follow: false },
};

export default function OrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  return (
    <AdminFrame
      current="orders"
      title={th.admin.orders.title}
      description={th.admin.orders.description}
    >
      <Suspense fallback={<AdminSkeleton rows={2} />}>
        <OrdersSection searchParams={searchParams} />
      </Suspense>
    </AdminFrame>
  );
}
