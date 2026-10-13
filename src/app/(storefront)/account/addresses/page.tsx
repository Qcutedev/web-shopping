import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountFrame } from "@/components/account/account-frame";
import { AddressesSection } from "@/components/account/addresses-section";
import { AccountSkeleton } from "@/components/account/load-state";
import { th } from "@/i18n/th";

export const metadata: Metadata = {
  title: th.account.addresses.title,
  robots: { index: false, follow: false },
};

export default function AccountAddressesPage({ searchParams }: PageProps<"/account/addresses">) {
  return (
    <AccountFrame
      current="addresses"
      title={th.account.addresses.title}
      description={th.account.addresses.description}
    >
      <Suspense fallback={<AccountSkeleton rows={2} />}>
        <AddressesSection searchParams={searchParams} />
      </Suspense>
    </AccountFrame>
  );
}
