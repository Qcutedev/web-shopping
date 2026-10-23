import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminFrame } from "@/components/admin/admin-frame";
import { AdminSkeleton } from "@/components/admin/load-state";
import { ReportsSection } from "@/components/admin/reports-section";
import { th } from "@/i18n/th";

export const metadata: Metadata = {
  title: th.admin.reports.title,
  robots: { index: false, follow: false },
};

export default function ReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  return (
    <AdminFrame
      current="reports"
      heading={th.admin.reports.title}
      description={th.admin.reports.description}
    >
      <Suspense fallback={<AdminSkeleton rows={2} />}>
        <ReportsSection searchParams={searchParams} />
      </Suspense>
    </AdminFrame>
  );
}
