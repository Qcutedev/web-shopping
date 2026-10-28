import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminFrame } from "@/components/admin/admin-frame";
import { AdminSkeleton } from "@/components/admin/load-state";
import { ReviewsSection } from "@/components/admin/reviews-section";
import { th } from "@/i18n/th";

export const metadata: Metadata = {
  title: th.admin.reviews.title,
  robots: { index: false, follow: false },
};

export default function ReviewsPage({ searchParams }: PageProps<"/admin/reviews">) {
  return (
    <AdminFrame
      current="reviews"
      heading={th.admin.reviews.title}
      description={th.admin.reviews.description}
    >
      <Suspense fallback={<AdminSkeleton rows={2} />}>
        <ReviewsSection searchParams={searchParams} />
      </Suspense>
    </AdminFrame>
  );
}
