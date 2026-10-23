import Link from "next/link";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { formatCount } from "./format-count";

/**
 * A GET form of filters. The values travel in the address bar, so a filtered page can be linked,
 * reloaded, and paged. Works without JavaScript.
 */
export function FilterForm({
  action,
  label,
  resetHref,
  children,
}: {
  action: string;
  label: string;
  resetHref: string;
  children: ReactNode;
}) {
  return (
    <form
      method="get"
      action={action}
      aria-label={label}
      className="border-border bg-surface flex flex-col gap-4 rounded-md border p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit">{th.admin.common.apply}</Button>
        <Link
          href={resetHref}
          className="type-label focus-ring inline-flex min-h-11 items-center rounded-sm underline underline-offset-4"
        >
          {th.admin.common.reset}
        </Link>
      </div>
    </form>
  );
}

/**
 * Body of an admin list page: filter form, a notice when a filter value was left out, the count
 * and the table, or the empty state that fits (nothing at all, nothing for the filter, a page past
 * the end), and the pagination. All four states of a data view: the loading state is the Suspense
 * fallback of the page and the error state comes from `renderForAdmin`.
 */
export function AdminListView({
  filterForm,
  ignored,
  itemCount,
  total,
  page,
  pageSize,
  filtered,
  basePath,
  hrefForPage,
  emptyTitle,
  emptyDescription,
  emptyAction,
  table,
  aboveTable,
}: {
  filterForm?: ReactNode;
  ignored: boolean;
  itemCount: number;
  total: number;
  page: number;
  pageSize: number;
  filtered: boolean;
  basePath: string;
  hrefForPage: (page: number) => string;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  table: ReactNode;
  aboveTable?: ReactNode;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  let body: ReactNode;
  if (itemCount > 0) {
    body = (
      <>
        <p role="status" className="type-small text-foreground-secondary">
          {fill(th.admin.common.count, { count: formatCount(total) })}
        </p>
        {aboveTable}
        {table}
      </>
    );
  } else if (total > 0) {
    body = (
      <EmptyState
        title={th.admin.common.pageEmptyTitle}
        action={
          <Link href={hrefForPage(1)} className={buttonVariants({ variant: "secondary" })}>
            {th.admin.common.pageEmptyAction}
          </Link>
        }
      />
    );
  } else if (filtered) {
    body = (
      <EmptyState
        title={th.admin.common.filteredEmptyTitle}
        description={th.admin.common.filteredEmptyDescription}
        action={
          <Link href={basePath} className={buttonVariants({ variant: "secondary" })}>
            {th.admin.common.reset}
          </Link>
        }
      />
    );
  } else {
    body = <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;
  }

  return (
    <div className="flex flex-col gap-6">
      {filterForm}
      {ignored ? (
        <Alert tone="warning" role="note">
          {th.admin.common.ignoredFilters}
        </Alert>
      ) : null}
      {body}
      {totalPages > 1 ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          hrefForPage={hrefForPage}
          label={th.pagination.label}
          previousLabel={th.pagination.previous}
          nextLabel={th.pagination.next}
          pageLabel={(number) => fill(th.pagination.page, { page: number })}
        />
      ) : null}
    </div>
  );
}
