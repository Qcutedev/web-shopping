import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { th } from "@/i18n/th";

/**
 * Loading state of an account section: a skeleton of the content, with a text that screen readers
 * announce. The skeleton itself is hidden from assistive technology.
 */
export function AccountSkeleton({ rows = 1 }: { rows?: number }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only" role="status">
        {th.account.loading}
      </span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="border-border flex flex-col gap-3 rounded-lg border p-4 md:p-6">
          <Skeleton className="h-6 w-1/3" />
          <SkeletonText lines={3} />
          <Skeleton className="h-9 w-24" />
        </div>
      ))}
    </div>
  );
}

/** Error state of a section that could not load. The retry is a link to the same page. */
export function AccountLoadError({ retryHref }: { retryHref: string }) {
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
