import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminFrame } from "@/components/admin/admin-frame";
import { AdminSkeleton } from "@/components/admin/load-state";
import { ProductsSection } from "@/components/admin/products-section";
import { th } from "@/i18n/th";

export const metadata: Metadata = {
  title: th.admin.products.title,
  robots: { index: false, follow: false },
};

export default function ProductsPage({ searchParams }: PageProps<"/admin/products">) {
  return (
    <AdminFrame
      current="products"
      title={th.admin.products.title}
      description={th.admin.products.description}
    >
      <Suspense fallback={<AdminSkeleton rows={2} />}>
        <ProductsSection searchParams={searchParams} />
      </Suspense>
    </AdminFrame>
  );
}
