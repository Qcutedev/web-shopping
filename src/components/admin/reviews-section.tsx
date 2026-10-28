import { InputField } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { th } from "@/i18n/th";
import { listReviews } from "@/modules/admin";
import type { AdminReviewDto } from "@/modules/admin/schema";
import { AdminListView, FilterForm } from "./list-view";
import { listHref, parseReviews, REVIEW_KEYS, type ParsedList } from "./queries";
import { ReviewsTable } from "./reviews-table";
import { ADMIN_ROUTES } from "./routes";
import type { SearchParams } from "./search-params";
import { renderForAdmin } from "./with-admin";

type Parsed = ParsedList<{ page: number; pageSize: number }>;

/** One page of reviews, hidden ones included, with the product and visibility filters (SEC-092). */
export function ReviewsListView({
  parsed,
  items,
  total,
}: {
  parsed: Parsed;
  items: readonly AdminReviewDto[];
  total: number;
}) {
  const { params, query } = parsed;
  const filter = th.admin.reviews.filter;
  return (
    <AdminListView
      ignored={parsed.ignored}
      itemCount={items.length}
      total={total}
      page={query.page}
      pageSize={query.pageSize}
      filtered={REVIEW_KEYS.some((key) => params.has(key))}
      basePath={ADMIN_ROUTES.reviews}
      hrefForPage={(page) =>
        listHref(ADMIN_ROUTES.reviews, REVIEW_KEYS, params, query.pageSize, page)
      }
      emptyTitle={th.admin.reviews.emptyTitle}
      filterForm={
        <FilterForm
          action={ADMIN_ROUTES.reviews}
          label={filter.formLabel}
          resetHref={ADMIN_ROUTES.reviews}
        >
          <InputField
            name="productId"
            label={filter.productId}
            defaultValue={params.get("productId") ?? ""}
            maxLength={200}
            autoComplete="off"
          />
          <SelectField
            name="hidden"
            label={filter.visibility}
            defaultValue={params.get("hidden") ?? ""}
          >
            <option value="">{th.admin.common.all}</option>
            <option value="true">{filter.onlyHidden}</option>
            <option value="false">{filter.onlyPublic}</option>
          </SelectField>
        </FilterForm>
      }
      table={<ReviewsTable items={items} />}
    />
  );
}

/** Server Component: one page of reviews through the module service, behind a Suspense boundary. */
export async function ReviewsSection({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const parsed = parseReviews(await searchParams);
  return renderForAdmin(ADMIN_ROUTES.reviews, async (actor) => {
    const page = await listReviews(actor, parsed.query);
    return <ReviewsListView parsed={parsed} items={page.items} total={page.total} />;
  });
}
