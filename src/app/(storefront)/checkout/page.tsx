import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountSkeleton } from "@/components/account/load-state";
import { CheckoutSection } from "@/components/checkout/checkout-section";
import { PageFrame } from "@/components/page-frame";
import { th } from "@/i18n/th";

export const metadata: Metadata = {
  title: th.checkout.title,
  robots: { index: false, follow: false },
};

export default function CheckoutPage() {
  return (
    <PageFrame heading={th.checkout.title} description={th.checkout.description}>
      <Suspense fallback={<AccountSkeleton rows={2} />}>
        <CheckoutSection />
      </Suspense>
    </PageFrame>
  );
}
