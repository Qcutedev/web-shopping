import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminFrame } from "@/components/admin/admin-frame";
import { AdminSkeleton } from "@/components/admin/load-state";
import { SettingsSection } from "@/components/admin/settings-section";
import { th } from "@/i18n/th";

export const metadata: Metadata = {
  title: th.admin.settings.title,
  robots: { index: false, follow: false },
};

export default function SettingsPage() {
  return (
    <AdminFrame
      current="settings"
      title={th.admin.settings.title}
      description={th.admin.settings.description}
    >
      <Suspense fallback={<AdminSkeleton rows={1} />}>
        <SettingsSection />
      </Suspense>
    </AdminFrame>
  );
}
