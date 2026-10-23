import { InputField } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { th } from "@/i18n/th";
import { listProducts } from "@/modules/admin";
import type { AdminProductDto } from "@/modules/admin/schema";
import { MODERATION_STATUSES, PRODUCT_STATUSES } from "@/modules/inventory/state";
import { AdminListView, FilterForm } from "./list-view";
import { listHref, parseProducts, PRODUCT_KEYS, type ParsedProducts } from "./queries";
import { ProductsTable } from "./products-table";
import { ADMIN_ROUTES } from "./routes";
import type { SearchParams } from "./search-params";
import { renderForAdmin } from "./with-admin";

/**
 * One page of products: the approval queue by default, oldest submission first (REQ-A-05, BR-36),
 * or every product with the status filters. The queue cannot be combined with a status filter, so
 * the two status selects apply to the full list only.
 */
export function ProductsListView({
  parsed,
  items,
  total,
}: {
  parsed: Pick<ParsedProducts, "params" | "ignored" | "view"> & {
    query: { page: number; pageSize: number };
  };
  items: readonly AdminProductDto[];
  total: number;
}) {
  const { params, query, view } = parsed;
  const filter = th.admin.products.filter;
  const queue = view === "queue";
  // The queue is the page with no other filter: nothing to clear and an empty queue is good news.
  const filtered = ["q", "storeId", "status", "moderationStatus"].some((key) => params.has(key));
  return (
    <AdminListView
      ignored={parsed.ignored}
      itemCount={items.length}
      total={total}
      page={query.page}
      pageSize={query.pageSize}
      filtered={filtered}
      basePath={queue ? ADMIN_ROUTES.products : `${ADMIN_ROUTES.products}?view=all`}
      hrefForPage={(page) =>
        listHref(ADMIN_ROUTES.products, PRODUCT_KEYS, params, query.pageSize, page)
      }
      emptyTitle={queue ? th.admin.products.queueEmptyTitle : th.admin.products.emptyTitle}
      emptyDescription={queue ? th.admin.products.queueEmptyDescription : undefined}
      filterForm={
        <FilterForm
          action={ADMIN_ROUTES.products}
          label={filter.title}
          resetHref={queue ? ADMIN_ROUTES.products : `${ADMIN_ROUTES.products}?view=all`}
        >
          <SelectField name="view" label={filter.view} defaultValue={view}>
            <option value="queue">{filter.viewQueue}</option>
            <option value="all">{filter.viewAll}</option>
          </SelectField>
          <InputField
            type="search"
            name="q"
            label={filter.q}
            defaultValue={params.get("q") ?? ""}
            maxLength={100}
            autoComplete="off"
          />
          <InputField
            name="storeId"
            label={filter.store}
            defaultValue={params.get("storeId") ?? ""}
            maxLength={200}
            autoComplete="off"
          />
          <SelectField
            name="status"
            label={filter.status}
            helperText={filter.allOnlyHelper}
            defaultValue={params.get("status") ?? ""}
          >
            <option value="">{th.admin.common.all}</option>
            {PRODUCT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {th.seller.status.product[status]}
              </option>
            ))}
          </SelectField>
          <SelectField
            name="moderationStatus"
            label={filter.moderation}
            helperText={filter.allOnlyHelper}
            defaultValue={params.get("moderationStatus") ?? ""}
          >
            <option value="">{th.admin.common.all}</option>
            {MODERATION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {th.seller.status.moderation[status]}
              </option>
            ))}
          </SelectField>
        </FilterForm>
      }
      table={<ProductsTable items={items} />}
    />
  );
}

/** Server Component: one page of products through the module service. */
export async function ProductsSection({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const parsed = parseProducts(await searchParams);
  return renderForAdmin(ADMIN_ROUTES.products, async (actor) => {
    const page = await listProducts(actor, parsed.query);
    return <ProductsListView parsed={parsed} items={page.items} total={page.total} />;
  });
}
