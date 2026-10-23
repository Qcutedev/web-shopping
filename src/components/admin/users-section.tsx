import { InputField } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { th } from "@/i18n/th";
import { listUsers } from "@/modules/admin";
import type { AdminUserDto } from "@/modules/admin/schema";
import { ROLES } from "@/server/auth/actor";
import { AdminListView, FilterForm } from "./list-view";
import { listHref, parseUsers, USER_KEYS, type ParsedList } from "./queries";
import { ADMIN_ROUTES } from "./routes";
import type { SearchParams } from "./search-params";
import { UsersTable } from "./users-table";
import { renderForAdmin } from "./with-admin";

type Parsed = ParsedList<{ page: number; pageSize: number }>;

/** One page of users with the search, role, and account-status filters (REQ-A-02). */
export function UsersListView({
  parsed,
  items,
  total,
  selfId,
}: {
  parsed: Parsed;
  items: readonly AdminUserDto[];
  total: number;
  selfId: string;
}) {
  const { params, query } = parsed;
  const filter = th.admin.users.filter;
  return (
    <AdminListView
      ignored={parsed.ignored}
      itemCount={items.length}
      total={total}
      page={query.page}
      pageSize={query.pageSize}
      filtered={USER_KEYS.some((key) => params.has(key))}
      basePath={ADMIN_ROUTES.users}
      hrefForPage={(page) => listHref(ADMIN_ROUTES.users, USER_KEYS, params, query.pageSize, page)}
      emptyTitle={th.admin.users.emptyTitle}
      filterForm={
        <FilterForm
          action={ADMIN_ROUTES.users}
          label={filter.formLabel}
          resetHref={ADMIN_ROUTES.users}
        >
          <InputField
            type="search"
            name="q"
            label={filter.q}
            defaultValue={params.get("q") ?? ""}
            maxLength={100}
            autoComplete="off"
          />
          <SelectField name="role" label={filter.role} defaultValue={params.get("role") ?? ""}>
            <option value="">{th.admin.common.all}</option>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {th.admin.users.roles[role]}
              </option>
            ))}
          </SelectField>
          <SelectField
            name="isActive"
            label={filter.active}
            defaultValue={params.get("isActive") ?? ""}
          >
            <option value="">{th.admin.common.all}</option>
            <option value="true">{filter.active_true}</option>
            <option value="false">{filter.active_false}</option>
          </SelectField>
        </FilterForm>
      }
      table={<UsersTable items={items} selfId={selfId} />}
    />
  );
}

/**
 * Server Component: one page of users through the module service. The filter passes through the
 * endpoint's own query schema. Renders behind a Suspense boundary.
 */
export async function UsersSection({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const parsed = parseUsers(await searchParams);
  return renderForAdmin(ADMIN_ROUTES.users, async (actor) => {
    const page = await listUsers(actor, parsed.query);
    return (
      <UsersListView parsed={parsed} items={page.items} total={page.total} selfId={actor.userId} />
    );
  });
}
