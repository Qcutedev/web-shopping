import Link from "next/link";
import { chipVariants } from "@/components/ui/chip";
import { th } from "@/i18n/th";
import { PRODUCT_SORTS, type ProductSort } from "@/modules/catalog/schema";

/** Sort order as links, so it works without JavaScript. Choosing an order returns to page 1. */
export function SortLinks({
  current,
  hrefForSort,
}: {
  current: ProductSort;
  hrefForSort: (sort: ProductSort) => string;
}) {
  return (
    <nav aria-label={th.catalog.sort.label} className="flex flex-wrap items-center gap-2">
      <span className="type-label text-foreground-secondary">{th.catalog.sort.label}</span>
      {PRODUCT_SORTS.map((sort) => (
        <Link
          key={sort}
          href={hrefForSort(sort)}
          aria-current={sort === current ? "true" : undefined}
          className={chipVariants({ selected: sort === current })}
        >
          {th.catalog.sort[sort]}
        </Link>
      ))}
    </nav>
  );
}
