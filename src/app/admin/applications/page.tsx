import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminFrame } from "@/components/admin/admin-frame";
import { AdminSkeleton } from "@/components/admin/load-state";
import { ApplicationsSection } from "@/components/admin/applications-section";
import { th } from "@/i18n/th";

export const metadata: Metadata = {
  title: th.admin.applications.title,
  robots: { index: false, follow: false },
};

export default function ApplicationsPage({ searchParams }: PageProps<"/admin/applications">) {
  return (
    <AdminFrame
      current="applications"
      heading={th.admin.applications.title}
      description={th.admin.applications.description}
    >
      <Suspense fallback={<AdminSkeleton rows={2} />}>
        <ApplicationsSection searchParams={searchParams} />
      </Suspense>
    </AdminFrame>
  );
}
