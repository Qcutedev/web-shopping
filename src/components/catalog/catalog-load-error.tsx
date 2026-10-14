import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { th } from "@/i18n/th";

/** Error state of a catalog read. The retry is a link to the same page. */
export function CatalogLoadError({ retryHref }: { retryHref: string }) {
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

/** The query string of a list page failed the catalog schema. The link resets the filters. */
export function CatalogInvalidFilter({ resetHref }: { resetHref: string }) {
  return (
    <ErrorState
      title={th.catalog.filterInvalidTitle}
      message={th.catalog.filterInvalid}
      action={
        <Link href={resetHref} className={buttonVariants({ variant: "secondary" })}>
          {th.errors.retry}
        </Link>
      }
    />
  );
}
