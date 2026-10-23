import { SelectField } from "@/components/ui/select";
import { th } from "@/i18n/th";
import { listApplications } from "@/modules/admin";
import type { AdminApplicationDto } from "@/modules/admin/schema";
import { APPLICATION_STATUSES } from "@/modules/sellers/state";
import { ApplicationsTable } from "./applications-table";
import { AdminListView, FilterForm } from "./list-view";
import { APPLICATION_KEYS, listHref, parseApplications, type ParsedList } from "./queries";
import { ADMIN_ROUTES } from "./routes";
import type { SearchParams } from "./search-params";
import { renderForAdmin } from "./with-admin";

/** One page of seller applications, oldest first, with the status filter (REQ-A-03). */
export function ApplicationsListView({
  parsed,
  items,
  total,
}: {
  parsed: ParsedList<{ page: number; pageSize: number }>;
  items: readonly AdminApplicationDto[];
  total: number;
}) {
  const { params, query } = parsed;
  return (
    <AdminListView
      ignored={parsed.ignored}
      itemCount={items.length}
      total={total}
      page={query.page}
      pageSize={query.pageSize}
      filtered={APPLICATION_KEYS.some((key) => params.has(key))}
      basePath={ADMIN_ROUTES.applications}
      hrefForPage={(page) =>
        listHref(ADMIN_ROUTES.applications, APPLICATION_KEYS, params, query.pageSize, page)
      }
      emptyTitle={th.admin.applications.emptyTitle}
      filterForm={
        <FilterForm
          action={ADMIN_ROUTES.applications}
          label={th.admin.applications.filter.title}
          resetHref={ADMIN_ROUTES.applications}
        >
          <SelectField
            name="status"
            label={th.admin.applications.filter.status}
            defaultValue={params.get("status") ?? ""}
          >
            <option value="">{th.admin.common.all}</option>
            {APPLICATION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {th.seller.status.application[status]}
              </option>
            ))}
          </SelectField>
        </FilterForm>
      }
      table={<ApplicationsTable items={items} />}
    />
  );
}

/** Server Component: one page of applications through the module service. */
export async function ApplicationsSection({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const parsed = parseApplications(await searchParams);
  return renderForAdmin(ADMIN_ROUTES.applications, async (actor) => {
    const page = await listApplications(actor, parsed.query);
    return <ApplicationsListView parsed={parsed} items={page.items} total={page.total} />;
  });
}
