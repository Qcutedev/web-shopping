import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountSkeleton } from "@/components/account/load-state";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { PageFrame } from "@/components/page-frame";
import { th } from "@/i18n/th";
import { SIGN_IN_NEXT_PARAM } from "@/lib/routes";
import { safeRedirectPath } from "@/server/auth/redirect";

export const metadata: Metadata = {
  title: th.auth.signUpTitle,
  robots: { index: false, follow: false },
};

export default function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  return (
    <PageFrame heading={th.auth.signUpTitle} description={th.auth.signUpDescription}>
      <Suspense fallback={<AccountSkeleton rows={3} />}>
        <SignUpContent searchParams={searchParams} />
      </Suspense>
    </PageFrame>
  );
}

async function SignUpContent({
  searchParams,
}: {
  searchParams: PageProps<"/sign-up">["searchParams"];
}) {
  const params = await searchParams;
  const next = safeRedirectPath(params[SIGN_IN_NEXT_PARAM]);
  return <SignUpForm next={next} />;
}
