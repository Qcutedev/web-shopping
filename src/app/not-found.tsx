import type { Metadata } from "next";
import Link from "next/link";
import { StorefrontShell } from "@/components/shell/storefront-shell";
import { buttonVariants } from "@/components/ui/button";
import { th } from "@/i18n/th";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = { title: th.notFound.title };

/**
 * Thai 404 page for unmatched URLs and `notFound()` calls (REQ-N-01). The root `not-found.tsx`
 * renders inside the root layout only, so it wraps itself in the shell to keep the header and
 * footer. `global-not-found` is experimental and not needed: the root layout is a single static one.
 */
export default function NotFound() {
  return (
    <StorefrontShell>
      <div className="container-page flex flex-col items-start gap-4 py-14">
        <h1 className="type-page-title text-foreground">{th.notFound.title}</h1>
        <p className="type-body text-foreground-secondary">{th.notFound.body}</p>
        <Link href={ROUTES.home} className={buttonVariants({ variant: "primary" })}>
          {th.notFound.backHome}
        </Link>
      </div>
    </StorefrontShell>
  );
}
