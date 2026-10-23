import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminFrame } from "@/components/admin/admin-frame";
import { AdminSkeleton } from "@/components/admin/load-state";
import { AuditSection } from "@/components/admin/audit-section";
import { th } from "@/i18n/th";

export const metadata: Metadata = {
  title: th.admin.audit.title,
  robots: { index: false, follow: false },
};

export default function AuditPage({ searchParams }: PageProps<"/admin/audit-logs">) {
  return (
    <AdminFrame
      current="auditLogs"
      heading={th.admin.audit.title}
      description={th.admin.audit.description}
    >
      <Suspense fallback={<AdminSkeleton rows={2} />}>
        <AuditSection searchParams={searchParams} />
      </Suspense>
    </AdminFrame>
  );
}
