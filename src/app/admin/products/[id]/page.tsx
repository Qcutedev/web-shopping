import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminFrame } from "@/components/admin/admin-frame";
import { AdminSkeleton } from "@/components/admin/load-state";
import { ProductSection } from "@/components/admin/product-section";
import { th } from "@/i18n/th";

export const metadata: Metadata = {
  title: th.admin.products.detailTitle,
  robots: { index: false, follow: false },
};

export default function ProductPage({ params }: PageProps<"/admin/products/[id]">) {
  return (
    <AdminFrame current="products" title={th.admin.products.detailTitle}>
      <Suspense fallback={<AdminSkeleton rows={3} />}>
        <ProductSection params={params} />
      </Suspense>
    </AdminFrame>
  );
}
