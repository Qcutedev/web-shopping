import Link from "next/link";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { th } from "@/i18n/th";
import {
  MAX_PRICE_FIELD,
  MIN_PRICE_FIELD,
  type PriceFilterError,
} from "@/components/catalog/price-filter";
import { DEFAULT_PRODUCT_SORT, type CategoryDto, type ProductSort } from "@/modules/catalog/schema";

const ERROR_TEXT: Record<PriceFilterError, string> = {
  "min-invalid": th.catalog.filter.minInvalid,
  "max-invalid": th.catalog.filter.maxInvalid,
  range: th.catalog.filter.range,
};

/**
 * Price (and, on search, category) filter as a plain GET form: it works without JavaScript and
 * the result is a shareable link. `q` and a non-default `sort` ride along as hidden fields; the
 * page number is left out so a new filter starts at page 1. Prices are typed in baht and
 * converted to satang on the server (`applyPriceFilter`). `categories` is given only where the
 * category can be chosen (search); elsewhere the path or the store fixes it.
 */
export function FilterForm({
  action,
  resetHref,
  q,
  sort,
  minText,
  maxText,
  errors,
  categories,
  category,
}: {
  action: string;
  resetHref: string;
  q?: string | undefined;
  sort: ProductSort;
  minText: string;
  maxText: string;
  errors: readonly PriceFilterError[];
  categories?: readonly CategoryDto[] | undefined;
  category?: string | undefined;
}) {
  // A range error concerns both fields, so both are marked invalid.
  const minError = errors.includes("min-invalid")
    ? ERROR_TEXT["min-invalid"]
    : errors.includes("range")
      ? ERROR_TEXT.range
      : undefined;
  const maxError = errors.includes("max-invalid")
    ? ERROR_TEXT["max-invalid"]
    : errors.includes("range")
      ? ERROR_TEXT.range
      : undefined;
  const summary = [...new Set(errors.map((error) => ERROR_TEXT[error]))];
  const hasCategories = categories !== undefined && categories.length > 0;
  const hasCategory = category !== undefined && category !== "";
  // Keep the filter when no select can carry it (categories failed to load, or a store/category
  // page fixes it), so submitting never widens the result set (CR-T021-11).
  const hiddenCategory = !hasCategories && hasCategory;
  const categoryMissing =
    hasCategories && hasCategory && !categories.some((item) => item.slug === category);
  return (
    <form
      method="get"
      action={action}
      aria-label={th.catalog.filter.title}
      className="border-border bg-surface flex flex-col gap-4 rounded-md border p-4"
    >
      {q !== undefined && q !== "" ? <input type="hidden" name="q" value={q} /> : null}
      {hiddenCategory ? <input type="hidden" name="category" value={category ?? ""} /> : null}
      {sort !== DEFAULT_PRODUCT_SORT ? <input type="hidden" name="sort" value={sort} /> : null}
      {summary.length > 0 ? (
        <div role="alert" className="text-danger type-body-sm">
          <p className="font-medium">{th.catalog.filter.errorSummary}</p>
          <ul className="list-disc ps-5">
            {summary.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {hasCategories ? (
          <SelectField
            id="filter-category"
            name="category"
            label={th.catalog.filter.category}
            defaultValue={category ?? ""}
          >
            <option value="">{th.catalog.filter.categoryAll}</option>
            {categoryMissing ? <option value={category}>{category}</option> : null}
            {categories.map((item) => (
              <option key={item.id} value={item.slug}>
                {item.name}
              </option>
            ))}
          </SelectField>
        ) : null}
        <InputField
          id="filter-min-price"
          name={MIN_PRICE_FIELD}
          label={th.catalog.filter.minPrice}
          inputMode="decimal"
          autoComplete="off"
          defaultValue={minText}
          helperText={th.catalog.filter.priceHelper}
          errorText={minError}
        />
        <InputField
          id="filter-max-price"
          name={MAX_PRICE_FIELD}
          label={th.catalog.filter.maxPrice}
          inputMode="decimal"
          autoComplete="off"
          defaultValue={maxText}
          helperText={th.catalog.filter.priceHelper}
          errorText={maxError}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit">{th.catalog.filter.apply}</Button>
        <Link
          href={resetHref}
          className="type-label focus-ring inline-flex min-h-11 items-center rounded-sm underline underline-offset-4"
        >
          {th.catalog.filter.reset}
        </Link>
      </div>
    </form>
  );
}

export function FilterFormSkeleton() {
  return <Skeleton aria-hidden="true" className="h-48 w-full rounded-md" />;
}
