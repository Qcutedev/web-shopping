import Link from "next/link";
import { chipVariants } from "@/components/ui/chip";
import { Skeleton } from "@/components/ui/skeleton";
import { th } from "@/i18n/th";
import { categoryHref } from "@/lib/routes";
import type { CategoryDto } from "@/modules/catalog/schema";

/** Category links. `currentSlug` marks the one being viewed. Renders nothing for no category. */
export function CategoryChipsView({
  categories,
  currentSlug,
}: {
  categories: readonly CategoryDto[];
  currentSlug?: string;
}) {
  if (categories.length === 0) return null;
  return (
    <nav aria-label={th.catalog.categories.label}>
      <ul className="flex flex-wrap gap-2">
        {categories.map((category) => (
          <li key={category.id}>
            <Link
              href={categoryHref(category.slug)}
              aria-current={category.slug === currentSlug ? "page" : undefined}
              className={chipVariants({ selected: category.slug === currentSlug })}
            >
              {category.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function CategoryChipsSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-wrap gap-2">
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className="h-11 w-24 rounded-full" />
      ))}
    </div>
  );
}
