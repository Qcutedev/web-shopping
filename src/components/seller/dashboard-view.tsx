import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { NoticeLabel } from "@/components/ui/notice-label";
import { Price } from "@/components/ui/price";
import { USER_NAME_CONTAINER_CLASS, UserName } from "@/components/user-name";
import { th } from "@/i18n/th";
import type { SellerSummaryDto } from "@/modules/orders/seller-schema";
import { FULFILMENT_STATUSES } from "@/modules/orders/state";
import type { SellerStoreDto } from "@/modules/sellers/schema";
import { PRODUCT_STATUSES } from "@/modules/inventory/state";
import { SELLER_ROUTES } from "./routes";
import { StoreStatusBadge } from "./status-badges";

function Tile({ href, label, value }: { href: string; label: string; value: number }) {
  return (
    <li>
      <Link
        href={href}
        className="border-border hover:bg-surface-muted focus-ring flex h-full flex-col gap-1 rounded-lg border p-4 transition-colors duration-150"
      >
        <span className="type-small text-foreground-secondary">{label}</span>
        <span className="type-section-title tabular-nums">{value.toLocaleString("th-TH")}</span>
      </Link>
    </li>
  );
}

/**
 * The seller dashboard (REQ-S-03). Every figure is a count or a sum the server computed from the
 * store's rows; nothing here adds, estimates, or filters. Each figure links to the list it counts.
 */
export function DashboardView({
  summary,
  store,
}: {
  summary: SellerSummaryDto;
  store: Pick<SellerStoreDto, "name" | "status" | "isSample">;
}) {
  const productTotal = PRODUCT_STATUSES.reduce(
    (sum, key) => sum + summary.productsByStatus[key],
    0,
  );
  const orderTotal = FULFILMENT_STATUSES.reduce((sum, key) => sum + summary.ordersByStatus[key], 0);

  return (
    <div className="flex flex-col gap-6">
      <Card as="section" padding="panel" aria-labelledby="dashboard-store">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="dashboard-store" className="type-panel-title">
            <span className="type-small text-foreground-secondary block">
              {th.seller.dashboard.storeLabel}
            </span>
            <span className={`block ${USER_NAME_CONTAINER_CLASS}`}>
              <UserName>{store.name}</UserName>
            </span>
          </h2>
          <StoreStatusBadge status={store.status} />
          {store.isSample ? <NoticeLabel>{th.notice.sampleData}</NoticeLabel> : null}
        </div>
      </Card>

      {productTotal === 0 && orderTotal === 0 ? (
        <EmptyState
          title={th.seller.dashboard.emptyTitle}
          description={th.seller.dashboard.emptyDescription}
          action={
            store.status === "APPROVED" ? (
              <Link href={SELLER_ROUTES.newProduct} className={buttonVariants()}>
                {th.seller.dashboard.emptyAction}
              </Link>
            ) : undefined
          }
        />
      ) : null}

      <Card as="section" padding="panel" aria-labelledby="dashboard-products">
        <CardTitle as="h2" size="panel" id="dashboard-products">
          {th.seller.dashboard.productsTitle}
        </CardTitle>
        <ul
          aria-label={th.seller.dashboard.productsByStatusLabel}
          className="mt-4 grid gap-3 sm:grid-cols-3"
        >
          {PRODUCT_STATUSES.map((status) => (
            <Tile
              key={status}
              href={`${SELLER_ROUTES.products}?status=${status}`}
              label={th.seller.status.product[status]}
              value={summary.productsByStatus[status]}
            />
          ))}
        </ul>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          <Tile
            href={`${SELLER_ROUTES.products}?lowStock=true`}
            label={th.seller.dashboard.lowStock}
            value={summary.lowStockCount}
          />
          <Tile
            href={`${SELLER_ROUTES.products}?soldOut=true`}
            label={th.seller.dashboard.soldOut}
            value={summary.soldOutCount}
          />
        </ul>
        <p className="type-small text-foreground-muted mt-3">{th.seller.dashboard.stockNote}</p>
      </Card>

      <Card as="section" padding="panel" aria-labelledby="dashboard-orders">
        <CardTitle as="h2" size="panel" id="dashboard-orders">
          {th.seller.dashboard.ordersTitle}
        </CardTitle>
        <p className="type-small text-foreground-muted mt-1">{th.seller.dashboard.ordersNote}</p>
        <ul
          aria-label={th.seller.dashboard.ordersByStatusLabel}
          className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        >
          {FULFILMENT_STATUSES.map((status) => (
            <Tile
              key={status}
              href={`${SELLER_ROUTES.orders}?fulfilmentStatus=${status}`}
              label={th.seller.status.fulfilment[status]}
              value={summary.ordersByStatus[status]}
            />
          ))}
        </ul>
      </Card>

      <Card as="section" padding="panel" aria-labelledby="dashboard-sales">
        <CardTitle as="h2" size="panel" id="dashboard-sales">
          {th.seller.dashboard.salesTitle}
        </CardTitle>
        <p className="type-small text-foreground-secondary mt-4">
          {th.seller.dashboard.salesTotal}
        </p>
        <p className="type-price-page">
          <Price satang={summary.paidSalesTotalSatang} />
        </p>
        <p className="type-small text-foreground-muted mt-1">{th.seller.dashboard.salesNote}</p>
      </Card>
    </div>
  );
}
