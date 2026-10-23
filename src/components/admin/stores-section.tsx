import { InputField } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { th } from "@/i18n/th";
import { listStores } from "@/modules/admin";
import type { AdminStoreDto } from "@/modules/admin/schema";
import { STORE_STATUSES } from "@/modules/sellers/state";
import { AdminListView, FilterForm } from "./list-view";
import { listHref, parseStores, STORE_KEYS, type ParsedList } from "./queries";
import { ADMIN_ROUTES } from "./routes";
import type { SearchParams } from "./search-params";
import { StoresTable } from "./stores-table";
import { renderForAdmin } from "./with-admin";

/** One page of stores, hidden ones included, with the search and status filters (REQ-A-04). */
export function StoresListView({
  parsed,
  items,
  total,
}: {
  parsed: ParsedList<{ page: number; pageSize: number }>;
  items: readonly AdminStoreDto[];
  total: number;
}) {
  const { params, query } = parsed;
  const filter = th.admin.stores.filter;
  return (
    <AdminListView
      ignored={parsed.ignored}
      itemCount={items.length}
      total={total}
      page={query.page}
      pageSize={query.pageSize}
      filtered={STORE_KEYS.some((key) => params.has(key))}
      basePath={ADMIN_ROUTES.stores}
      hrefForPage={(page) =>
        listHref(ADMIN_ROUTES.stores, STORE_KEYS, params, query.pageSize, page)
      }
      emptyTitle={th.admin.stores.emptyTitle}
      filterForm={
        <FilterForm
          action={ADMIN_ROUTES.stores}
          label={filter.formLabel}
          resetHref={ADMIN_ROUTES.stores}
        >
          <InputField
            type="search"
            name="q"
            label={filter.q}
            defaultValue={params.get("q") ?? ""}
            maxLength={100}
            autoComplete="off"
          />
          <SelectField
            name="status"
            label={filter.status}
            defaultValue={params.get("status") ?? ""}
          >
            <option value="">{th.admin.common.all}</option>
            {STORE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {th.seller.status.store[status]}
              </option>
            ))}
          </SelectField>
        </FilterForm>
      }
      table={<StoresTable items={items} />}
    />
  );
}

/** Server Component: one page of stores through the module service. */
export async function StoresSection({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const parsed = parseStores(await searchParams);
  return renderForAdmin(ADMIN_ROUTES.stores, async (actor) => {
    const page = await listStores(actor, parsed.query);
    return <StoresListView parsed={parsed} items={page.items} total={page.total} />;
  });
}
