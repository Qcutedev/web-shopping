import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { th } from "@/i18n/th";

/** Loading state of an admin section: skeleton blocks and a text that screen readers announce. */
export function AdminSkeleton({ rows = 1 }: { rows?: number }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only" role="status">
        {th.admin.loading}
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
export function AdminLoadError({ retryHref }: { retryHref: string }) {
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

/** A signed-in person who is not an admin. The server refuses the data either way. */
export function AdminForbiddenState() {
  return (
    <EmptyState title={th.admin.guard.forbiddenTitle} description={th.admin.guard.forbiddenBody} />
  );
}

/** The record does not exist: unknown or malformed id, with the way back to the list. */
export function AdminNotFoundState({
  backHref,
  backLabel,
}: {
  backHref: string;
  backLabel: string;
}) {
  return (
    <EmptyState
      title={th.admin.guard.notFoundTitle}
      description={th.admin.guard.notFoundBody}
      action={
        <Link href={backHref} className={buttonVariants({ variant: "secondary" })}>
          {backLabel}
        </Link>
      }
    />
  );
}
