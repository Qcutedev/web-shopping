import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminFrame } from "@/components/admin/admin-frame";
import { AdminSkeleton } from "@/components/admin/load-state";
import { UsersSection } from "@/components/admin/users-section";
import { th } from "@/i18n/th";

export const metadata: Metadata = {
  title: th.admin.users.title,
  robots: { index: false, follow: false },
};

export default function UsersPage({ searchParams }: PageProps<"/admin/users">) {
  return (
    <AdminFrame
      current="users"
      title={th.admin.users.title}
      description={th.admin.users.description}
    >
      <Suspense fallback={<AdminSkeleton rows={2} />}>
        <UsersSection searchParams={searchParams} />
      </Suspense>
    </AdminFrame>
  );
}
