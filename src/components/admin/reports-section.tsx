import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { InputField } from "@/components/ui/input";
import { Price } from "@/components/ui/price";
import { StatCard } from "@/components/ui/stat-card";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { formatDate } from "@/lib/format";
import { getReport } from "@/modules/admin";
import type { ReportDto } from "@/modules/admin/schema";
import { formatCount } from "./format-count";
import { parseReport } from "./queries";
import { ADMIN_ROUTES } from "./routes";
import type { SearchParams } from "./search-params";
import { renderForAdmin } from "./with-admin";

function RangeForm({ from, to }: { from: string; to: string }) {
  return (
    <form
      method="get"
      action={ADMIN_ROUTES.reports}
      aria-label={th.admin.reports.formTitle}
      className="border-border bg-surface flex flex-col gap-4 rounded-md border p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <InputField
          type="date"
          name="from"
          label={th.admin.common.dateFrom}
          defaultValue={from}
          required
        />
        <InputField
          type="date"
          name="to"
          label={th.admin.common.dateTo}
          helperText={th.admin.common.dateNote}
          defaultValue={to}
          required
        />
      </div>
      <div>
        <Button type="submit">{th.admin.reports.submit}</Button>
      </div>
    </form>
  );
}

/**
 * The report of one range (REQ-A-08): orders and revenue by the day the order was paid, new users
 * and new sellers by their own dates. The figures are the server's; the range is two Bangkok
 * calendar days, both included. The link opens the order list filtered by the same range, which
 * holds every order the figure counts (BR-40).
 */
export function ReportView({ report, from, to }: { report: ReportDto; from: string; to: string }) {
  const text = th.admin.reports;
  // `to` of the report is exclusive: the last day shown is the day before it ends.
  const lastDay = new Date(new Date(report.to).getTime() - 1);
  return (
    <Card as="section" padding="panel" aria-labelledby="report-result-title">
      <CardTitle as="h2" size="panel" id="report-result-title">
        {text.resultTitle}
      </CardTitle>
      <p className="type-small text-foreground-secondary mt-1">
        {fill(text.range, { from: formatDate(report.from), to: formatDate(lastDay) })}
      </p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard as="li" label={text.orders} value={formatCount(report.orderCount)} />
        <StatCard
          as="li"
          label={text.revenue}
          value={<Price satang={report.paidRevenueSatang} />}
        />
        <StatCard as="li" label={text.newUsers} value={formatCount(report.newUserCount)} />
        <StatCard as="li" label={text.newSellers} value={formatCount(report.newSellerCount)} />
      </ul>
      <p className="type-small text-foreground-muted mt-3">{text.paidNote}</p>
      <div className="mt-4">
        <Link
          href={`${ADMIN_ROUTES.orders}?paidFrom=${encodeURIComponent(from)}&paidTo=${encodeURIComponent(to)}`}
          className={buttonVariants({ variant: "secondary" })}
        >
          {text.viewOrders}
        </Link>
      </div>
    </Card>
  );
}

/**
 * Server Component: the report for the range in the address bar. Without a complete range it asks
 * for one instead of showing a figure for a guess; a refused range is said so.
 */
export async function ReportsSection({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const parsed = parseReport(await searchParams);
  const from = parsed.params.get("from") ?? "";
  const to = parsed.params.get("to") ?? "";
  return renderForAdmin(ADMIN_ROUTES.reports, async (actor) => {
    if (parsed.query === null) {
      return (
        <div className="flex flex-col gap-6">
          <RangeForm from={from} to={to} />
          {parsed.ignored ? (
            <Alert tone="warning" role="note">
              {th.admin.reports.rangeInvalid}
            </Alert>
          ) : null}
          <EmptyState
            title={th.admin.reports.emptyTitle}
            description={th.admin.reports.emptyDescription}
          />
        </div>
      );
    }
    const report = await getReport(actor, parsed.query);
    return (
      <div className="flex flex-col gap-6">
        <RangeForm from={from} to={to} />
        <ReportView report={report} from={from} to={to} />
      </div>
    );
  });
}
