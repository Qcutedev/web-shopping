import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountSkeleton } from "@/components/account/load-state";
import { CartSection } from "@/components/cart/cart-section";
import { PageFrame } from "@/components/page-frame";
import { th } from "@/i18n/th";

export const metadata: Metadata = {
  title: th.cart.title,
  robots: { index: false, follow: false },
};

export default function CartPage() {
  return (
    <PageFrame heading={th.cart.title} description={th.cart.description}>
      <Suspense fallback={<AccountSkeleton rows={2} />}>
        <CartSection />
      </Suspense>
    </PageFrame>
  );
}
