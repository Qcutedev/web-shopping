import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountSkeleton } from "@/components/account/load-state";
import { SignInForm } from "@/components/auth/sign-in-form";
import { PageFrame } from "@/components/page-frame";
import { th } from "@/i18n/th";
import { SIGN_IN_NEXT_PARAM } from "@/lib/routes";
import { safeRedirectPath } from "@/server/auth/redirect";

export const metadata: Metadata = {
  title: th.auth.signInTitle,
  robots: { index: false, follow: false },
};

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <PageFrame heading={th.auth.signInTitle} description={th.auth.signInDescription}>
      <Suspense fallback={<AccountSkeleton rows={2} />}>
        <SignInContent searchParams={searchParams} />
      </Suspense>
    </PageFrame>
  );
}

async function SignInContent({
  searchParams,
}: {
  searchParams: PageProps<"/sign-in">["searchParams"];
}) {
  const params = await searchParams;
  // The address bar is not trusted: only a same-origin path is kept (TM-19).
  const next = safeRedirectPath(params[SIGN_IN_NEXT_PARAM]);
  return <SignInForm next={next} />;
}
