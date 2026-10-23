import { th } from "@/i18n/th";
import { listCategories } from "@/modules/admin";
import type { AdminCategoryDto } from "@/modules/admin/schema";
import { CategoriesTable, CategoryCreateForm } from "./categories-panel";
import { AdminListView } from "./list-view";
import { CATEGORY_KEYS, listHref, parseCategories, type ParsedList } from "./queries";
import { ADMIN_ROUTES } from "./routes";
import type { SearchParams } from "./search-params";
import { renderForAdmin } from "./with-admin";

/**
 * One page of categories, inactive ones included, under the create form (REQ-A-06). With no
 * category the empty state sits beside the form that adds the first one.
 */
export function CategoriesListView({
  parsed,
  items,
  total,
}: {
  parsed: ParsedList<{ page: number; pageSize: number }>;
  items: readonly AdminCategoryDto[];
  total: number;
}) {
  const { params, query } = parsed;
  return (
    <div className="flex flex-col gap-6">
      <CategoryCreateForm />
      <AdminListView
        ignored={parsed.ignored}
        itemCount={items.length}
        total={total}
        page={query.page}
        pageSize={query.pageSize}
        filtered={false}
        basePath={ADMIN_ROUTES.categories}
        hrefForPage={(page) =>
          listHref(ADMIN_ROUTES.categories, CATEGORY_KEYS, params, query.pageSize, page)
        }
        emptyTitle={th.admin.categories.emptyTitle}
        emptyDescription={th.admin.categories.emptyDescription}
        table={<CategoriesTable items={items} />}
      />
    </div>
  );
}

/** Server Component: one page of categories through the module service. */
export async function CategoriesSection({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const parsed = parseCategories(await searchParams);
  return renderForAdmin(ADMIN_ROUTES.categories, async (actor) => {
    const page = await listCategories(actor, parsed.query);
    return <CategoriesListView parsed={parsed} items={page.items} total={page.total} />;
  });
}
