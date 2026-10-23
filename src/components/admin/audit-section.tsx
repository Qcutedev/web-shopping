import { InputField } from "@/components/ui/input";
import { th } from "@/i18n/th";
import { listAuditLogs } from "@/modules/admin";
import type { AuditLogDto } from "@/modules/admin/schema";
import { AuditTable } from "./audit-table";
import { AdminListView, FilterForm } from "./list-view";
import { AUDIT_KEYS, listHref, parseAuditLogs, type ParsedList } from "./queries";
import { ADMIN_ROUTES } from "./routes";
import type { SearchParams } from "./search-params";
import { renderForAdmin } from "./with-admin";

/** One page of the audit log, newest first, read-only (REQ-A-10). */
export function AuditListView({
  parsed,
  items,
  total,
}: {
  parsed: ParsedList<{ page: number; pageSize: number }>;
  items: readonly AuditLogDto[];
  total: number;
}) {
  const { params, query } = parsed;
  const filter = th.admin.audit.filter;
  return (
    <AdminListView
      ignored={parsed.ignored}
      itemCount={items.length}
      total={total}
      page={query.page}
      pageSize={query.pageSize}
      filtered={AUDIT_KEYS.some((key) => params.has(key))}
      basePath={ADMIN_ROUTES.auditLogs}
      hrefForPage={(page) =>
        listHref(ADMIN_ROUTES.auditLogs, AUDIT_KEYS, params, query.pageSize, page)
      }
      emptyTitle={th.admin.audit.emptyTitle}
      filterForm={
        <FilterForm
          action={ADMIN_ROUTES.auditLogs}
          label={filter.title}
          resetHref={ADMIN_ROUTES.auditLogs}
        >
          <InputField
            name="action"
            label={filter.action}
            defaultValue={params.get("action") ?? ""}
            maxLength={64}
            autoComplete="off"
          />
          <InputField
            name="targetType"
            label={filter.targetType}
            defaultValue={params.get("targetType") ?? ""}
            maxLength={64}
            autoComplete="off"
          />
          <InputField
            name="targetId"
            label={filter.targetId}
            defaultValue={params.get("targetId") ?? ""}
            maxLength={200}
            autoComplete="off"
          />
          <InputField
            name="actorId"
            label={filter.actorId}
            defaultValue={params.get("actorId") ?? ""}
            maxLength={200}
            autoComplete="off"
          />
          <InputField
            type="date"
            name="from"
            label={th.admin.common.dateFrom}
            defaultValue={params.get("from") ?? ""}
          />
          <InputField
            type="date"
            name="to"
            label={th.admin.common.dateTo}
            helperText={th.admin.common.dateNote}
            defaultValue={params.get("to") ?? ""}
          />
        </FilterForm>
      }
      table={<AuditTable items={items} />}
    />
  );
}

/** Server Component: one page of audit entries through the module service. */
export async function AuditSection({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const parsed = parseAuditLogs(await searchParams);
  return renderForAdmin(ADMIN_ROUTES.auditLogs, async (actor) => {
    const page = await listAuditLogs(actor, parsed.query);
    return <AuditListView parsed={parsed} items={page.items} total={page.total} />;
  });
}
