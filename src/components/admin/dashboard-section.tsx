import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { NoticeLabel } from "@/components/ui/notice-label";
import { Price } from "@/components/ui/price";
import { StatCard } from "@/components/ui/stat-card";
import { th } from "@/i18n/th";
import { getSummary } from "@/modules/admin";
import type { AdminSummaryDto } from "@/modules/admin/schema";
import { STORE_STATUSES } from "@/modules/sellers/state";
import { formatCount } from "./format-count";
import { ADMIN_ROUTES } from "./routes";
import { renderForAdmin } from "./with-admin";

function Tile({ href, label, value }: { href?: string; label: string; value: number }) {
  return <StatCard as="li" href={href} label={label} value={formatCount(value)} />;
}

/**
 * The admin dashboard (REQ-A-01): four groups of figures from real rows. Every figure is a count
 * or a sum the server computed; nothing here adds, estimates, or filters. Each figure that has a
 * list links to it.
 */
export function DashboardView({ summary }: { summary: AdminSummaryDto }) {
  const text = th.admin.dashboard;
  return (
    <div className="flex flex-col gap-6">
      <Card as="section" padding="panel" aria-labelledby="dashboard-review">
        <CardTitle as="h2" size="panel" id="dashboard-review">
          {text.reviewTitle}
        </CardTitle>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          <Tile
            href={`${ADMIN_ROUTES.applications}?status=PENDING`}
            label={text.pendingApplications}
            value={summary.pendingApplicationCount}
          />
          <Tile
            href={ADMIN_ROUTES.products}
            label={text.pendingProducts}
            value={summary.pendingProductCount}
          />
        </ul>
      </Card>

      <Card as="section" padding="panel" aria-labelledby="dashboard-people">
        <CardTitle as="h2" size="panel" id="dashboard-people">
          {text.peopleTitle}
        </CardTitle>
        <ul className="mt-4 grid gap-3 sm:grid-cols-3">
          <Tile href={ADMIN_ROUTES.users} label={text.users} value={summary.userCount} />
        </ul>
        <ul aria-label={text.storesByStatusLabel} className="mt-3 grid gap-3 sm:grid-cols-3">
          {STORE_STATUSES.map((status) => (
            <Tile
              key={status}
              href={`${ADMIN_ROUTES.stores}?status=${status}`}
              label={th.seller.status.store[status]}
              value={summary.storesByStatus[status]}
            />
          ))}
        </ul>
      </Card>

      <Card as="section" padding="panel" aria-labelledby="dashboard-orders">
        <CardTitle as="h2" size="panel" id="dashboard-orders">
          {text.ordersTitle}
        </CardTitle>
        <ul className="mt-4 grid gap-3 sm:grid-cols-3">
          <Tile href={ADMIN_ROUTES.orders} label={text.orders} value={summary.orderCount} />
        </ul>
        <p className="type-small text-foreground-muted mt-3">{text.ordersNote}</p>
      </Card>

      <Card as="section" padding="panel" aria-labelledby="dashboard-sales">
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle as="h2" size="panel" id="dashboard-sales">
            {text.salesTitle}
          </CardTitle>
          <NoticeLabel>{th.notice.mockPayment}</NoticeLabel>
        </div>
        <p className="type-small text-foreground-secondary mt-4">{text.sales}</p>
        <p className="type-price-page">
          <Price satang={summary.paidRevenueSatang} />
        </p>
        <p className="type-small text-foreground-muted mt-1">{text.salesNote}</p>
        <div className="mt-4">
          <Link href={ADMIN_ROUTES.reports} className={buttonVariants({ variant: "secondary" })}>
            {th.admin.nav.reports}
          </Link>
        </div>
      </Card>
    </div>
  );
}

/**
 * Server Component: the summary figures through the module service. Reads the session, so it
 * renders behind a Suspense boundary.
 */
export async function DashboardSection() {
  return renderForAdmin(ADMIN_ROUTES.dashboard, async (actor) => {
    const summary = await getSummary(actor);
    return <DashboardView summary={summary} />;
  });
}
