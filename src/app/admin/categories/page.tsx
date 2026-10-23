import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminFrame } from "@/components/admin/admin-frame";
import { AdminSkeleton } from "@/components/admin/load-state";
import { CategoriesSection } from "@/components/admin/categories-section";
import { th } from "@/i18n/th";

export const metadata: Metadata = {
  title: th.admin.categories.title,
  robots: { index: false, follow: false },
};

export default function CategoriesPage({ searchParams }: PageProps<"/admin/categories">) {
  return (
    <AdminFrame
      current="categories"
      heading={th.admin.categories.title}
      description={th.admin.categories.description}
    >
      <Suspense fallback={<AdminSkeleton rows={2} />}>
        <CategoriesSection searchParams={searchParams} />
      </Suspense>
    </AdminFrame>
  );
}
