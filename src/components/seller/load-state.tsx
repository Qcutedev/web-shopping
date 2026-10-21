import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { th } from "@/i18n/th";
import { SELLER_ROUTES } from "./routes";

/**
 * Loading state of a seller section: skeleton blocks with a text that screen readers announce.
 * The skeleton itself is hidden from assistive technology.
 */
export function SellerSkeleton({ rows = 1 }: { rows?: number }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only" role="status">
        {th.seller.loading}
      </span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="border-border flex flex-col gap-3 rounded-lg border p-4 md:p-6">
          <Skeleton className="h-6 w-1/3" />
          <SkeletonText lines={3} />
        </div>
      ))}
    </div>
  );
}

/** Error state of a section that could not load. The retry is a link to the same page. */
export function SellerLoadError({ retryHref }: { retryHref: string }) {
  return (
    <ErrorState
      title={th.errors.loadFailedTitle}
      message={th.errors.loadFailed}
      action={
        <Link href={retryHref} className={buttonVariants({ variant: "secondary" })}>
          {th.errors.retry}
        </Link>
      }
    />
  );
}

/** A signed-in person who is not a seller: the next step is to apply. */
export function NotSellerState() {
  return (
    <EmptyState
      title={th.seller.guard.customerTitle}
      description={th.seller.guard.customerBody}
      action={
        <Link href={SELLER_ROUTES.apply} className={buttonVariants()}>
          {th.seller.guard.customerAction}
        </Link>
      }
    />
  );
}

/** An account whose role has no use for the seller pages (an admin). */
export function SellerForbiddenState() {
  return (
    <EmptyState
      title={th.seller.guard.forbiddenTitle}
      description={th.seller.guard.forbiddenBody}
    />
  );
}

/**
 * The record does not exist for this store: unknown, deleted, or another store's. The same text
 * for all three, as the server's 404 is.
 */
export function SellerNotFoundState({
  backHref,
  backLabel,
}: {
  backHref: string;
  backLabel: string;
}) {
  return (
    <EmptyState
      title={th.seller.guard.notFoundTitle}
      description={th.seller.guard.notFoundBody}
      action={
        <Link href={backHref} className={buttonVariants({ variant: "secondary" })}>
          {backLabel}
        </Link>
      }
    />
  );
}
