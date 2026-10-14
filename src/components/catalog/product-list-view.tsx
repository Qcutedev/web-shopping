import Link from "next/link";
import { ProductGrid } from "@/components/catalog/product-grid";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import type { Page, ProductListItemDto } from "@/modules/catalog/schema";

export interface ListEmpty {
  title: string;
  description: string;
  /** The one next action, for example a link to the whole catalogue. */
  action: { href: string; label: string };
}

/**
 * Success and empty states of a product list, from data already loaded. Three cases: the list is
 * empty (message and a next action), the page is past the last one (message and a link to page
 * 1), or products are shown with the count and the pager.
 */
export function ProductListView({
  data,
  hrefForPage,
  empty,
  showCount = false,
}: {
  data: Page<ProductListItemDto>;
  hrefForPage: (page: number) => string;
  empty: ListEmpty;
  showCount?: boolean;
}) {
  if (data.total === 0) {
    return (
      <EmptyState
        title={empty.title}
        description={empty.description}
        action={
          <Link href={empty.action.href} className={buttonVariants({ variant: "primary" })}>
            {empty.action.label}
          </Link>
        }
      />
    );
  }
  if (data.items.length === 0) {
    return (
      <EmptyState
        title={th.catalog.list.pageEmptyTitle}
        action={
          <Link href={hrefForPage(1)} className={buttonVariants({ variant: "primary" })}>
            {th.catalog.list.pageEmptyAction}
          </Link>
        }
      />
    );
  }
  const totalPages = Math.ceil(data.total / data.pageSize);
  return (
    <div className="flex flex-col gap-6">
      {showCount ? (
        <p className="type-small text-foreground-secondary" role="status">
          {fill(th.catalog.search.count, { total: data.total })}
        </p>
      ) : null}
      <ProductGrid products={data.items} />
      <Pagination
        page={data.page}
        totalPages={totalPages}
        hrefForPage={hrefForPage}
        label={th.pagination.label}
        previousLabel={th.pagination.previous}
        nextLabel={th.pagination.next}
        pageLabel={(page) => fill(th.pagination.page, { page })}
      />
    </div>
  );
}
