import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountFrame } from "@/components/account/account-frame";
import { AccountSkeleton } from "@/components/account/load-state";
import { ProfileSection } from "@/components/account/profile-section";
import { th } from "@/i18n/th";

// A personal page: kept out of search results.
export const metadata: Metadata = {
  title: th.account.profile.title,
  robots: { index: false, follow: false },
};

// The session is read behind the boundary, so the frame and the skeleton are in the static shell.
export default function AccountPage() {
  return (
    <AccountFrame
      current="profile"
      title={th.account.profile.title}
      description={th.account.profile.description}
    >
      <Suspense fallback={<AccountSkeleton />}>
        <ProfileSection />
      </Suspense>
    </AccountFrame>
  );
}
