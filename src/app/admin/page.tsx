import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminFrame } from "@/components/admin/admin-frame";
import { AdminSkeleton } from "@/components/admin/load-state";
import { DashboardSection } from "@/components/admin/dashboard-section";
import { th } from "@/i18n/th";

export const metadata: Metadata = {
  title: th.admin.dashboard.title,
  robots: { index: false, follow: false },
};

export default function DashboardPage() {
  return (
    <AdminFrame
      current="dashboard"
      title={th.admin.dashboard.title}
      description={th.admin.dashboard.description}
    >
      <Suspense fallback={<AdminSkeleton rows={3} />}>
        <DashboardSection />
      </Suspense>
    </AdminFrame>
  );
}
