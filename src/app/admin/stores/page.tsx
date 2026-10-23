import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminFrame } from "@/components/admin/admin-frame";
import { AdminSkeleton } from "@/components/admin/load-state";
import { StoresSection } from "@/components/admin/stores-section";
import { th } from "@/i18n/th";

export const metadata: Metadata = {
  title: th.admin.stores.title,
  robots: { index: false, follow: false },
};

export default function StoresPage({ searchParams }: PageProps<"/admin/stores">) {
  return (
    <AdminFrame
      current="stores"
      heading={th.admin.stores.title}
      description={th.admin.stores.description}
    >
      <Suspense fallback={<AdminSkeleton rows={2} />}>
        <StoresSection searchParams={searchParams} />
      </Suspense>
    </AdminFrame>
  );
}
