import { ProductCard } from "@/components/catalog/product-card";
import { Skeleton } from "@/components/ui/skeleton";
import { th } from "@/i18n/th";
import type { ProductListItemDto } from "@/modules/catalog/schema";

const GRID = "grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-3 md:gap-x-4 lg:grid-cols-4";

export function ProductGrid({
  products,
  label = th.catalog.productListLabel,
}: {
  products: readonly ProductListItemDto[];
  label?: string;
}) {
  return (
    <ul aria-label={label} className={GRID}>
      {products.map((product, index) => (
        <li key={product.id}>
          <ProductCard product={product} priority={index < 4} />
        </li>
      ))}
    </ul>
  );
}

/** Loading state: the same grid, with a text that assistive technology announces. */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div aria-busy="true">
      <span role="status" className="sr-only">
        {th.catalog.loading}
      </span>
      <div className={GRID} aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton className="aspect-square w-full rounded-lg" />
            <Skeleton className="h-5 w-4/5" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-6 w-1/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
