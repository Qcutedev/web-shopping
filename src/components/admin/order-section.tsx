import Link from "next/link";
import type { ReactNode } from "react";
import { ProductImage } from "@/components/catalog/product-image";
import { PaymentBadge } from "@/components/orders/status-badges";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { NoticeLabel } from "@/components/ui/notice-label";
import { Price } from "@/components/ui/price";
import { USER_NAME_CONTAINER_CLASS, UserName } from "@/components/user-name";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { formatDateTime } from "@/lib/format";
import { getOrder } from "@/modules/admin";
import {
  type AdminOrderDto,
  type AdminSellerOrderDto,
  idParamsSchema,
} from "@/modules/admin/schema";
import { isFulfilmentTransitionAllowed } from "@/modules/orders/state";
import { notFound } from "@/server/errors";
import { AdminAction } from "./action-button";
import { formatCount } from "./format-count";
import { AdminNotFoundState } from "./load-state";
import { PartStatus } from "./part-status";
import { ADMIN_ROUTES, adminOrderHref } from "./routes";
import { renderForAdmin } from "./with-admin";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="type-label text-foreground-secondary">{label}</dt>
      <dd className={USER_NAME_CONTAINER_CLASS}>{children}</dd>
    </>
  );
}

/** A rate as a percent for reading: 500 basis points is "5". Not money, and recorded only (BR-13). */
function percentOf(bps: number): string {
  return (bps / 100).toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

/**
 * What an admin may do to one part (REQ-A-07, BR-20, BR-29). The buttons follow the transition
 * table the server enforces (`ADMIN` rows) only to save a refused click: cancel a pending or
 * processing part, paid or not; mark a shipped part delivered. A part of a failed order has no
 * action. The server judges every request.
 */
function PartActions({ order, part }: { order: AdminOrderDto; part: AdminSellerOrderDto }) {
  const text = th.admin.orders.actions;
  const returnTo = adminOrderHref(order.id);
  if (order.paymentStatus === "FAILED") {
    return (
      <p className="type-small text-foreground-secondary mt-4">{th.admin.orders.failedNote}</p>
    );
  }
  const canCancel = isFulfilmentTransitionAllowed(part.fulfilmentStatus, "CANCELLED", "ADMIN");
  const canDeliver = isFulfilmentTransitionAllowed(part.fulfilmentStatus, "DELIVERED", "ADMIN");
  return (
    <div className="mt-4 flex flex-col gap-2">
      <h3 className="type-card-title">{text.heading}</h3>
      {!canCancel && !canDeliver ? (
        <p className="type-small text-foreground-secondary">{text.none}</p>
      ) : null}
      {part.fulfilmentStatus === "SHIPPED" ? (
        <p className="type-small text-foreground-muted">{text.shippedLocked}</p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {canDeliver ? (
          <AdminAction
            size="md"
            spec={{ kind: "order.deliver", id: part.id }}
            returnTo={returnTo}
          />
        ) : null}
        {canCancel ? (
          <AdminAction size="md" spec={{ kind: "order.cancel", id: part.id }} returnTo={returnTo} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * One order with every per-store part as the server returned it (REQ-A-07, BR-20, BR-21, BR-39).
 * Amounts are the copies stored at purchase and the totals are the server's; nothing is added up
 * here. The paid time is shown only for a paid order, never as a placeholder. The payment is a mock
 * and the shipping is simulated, and both are labelled.
 */
export function OrderDetailView({ order }: { order: AdminOrderDto }) {
  const text = th.admin.orders;
  const address = order.shippingAddress;
  return (
    <div className="flex flex-col gap-6">
      {order.paymentStatus === "FAILED" ? (
        <Alert tone="danger" title={th.order.paymentFailed}>
          {text.failedNote}
        </Alert>
      ) : null}

      <Card as="section" padding="panel" aria-labelledby="order-summary-title">
        <CardTitle as="h2" size="panel" id="order-summary-title">
          {text.summaryTitle}
        </CardTitle>
        <dl className="mt-4 grid gap-4 sm:grid-cols-[max-content_1fr] sm:gap-x-8">
          <Row label={text.orderNumber}>{order.orderNumber}</Row>
          <Row label={text.placedAt}>{formatDateTime(order.createdAt)}</Row>
          {order.paidAt !== null ? (
            <Row label={text.paidAt}>{formatDateTime(order.paidAt)}</Row>
          ) : null}
          <Row label={text.payment}>
            <span className="flex flex-wrap items-center gap-2">
              <PaymentBadge status={order.paymentStatus} />
              {order.payment.isSimulated ? (
                <NoticeLabel>{th.notice.mockPayment}</NoticeLabel>
              ) : null}
            </span>
          </Row>
          <Row label={text.buyer}>{order.userId}</Row>
        </dl>
      </Card>

      <Card as="section" padding="panel" aria-labelledby="order-address-title">
        <CardTitle as="h2" size="panel" id="order-address-title">
          {text.addressTitle}
        </CardTitle>
        <p className="type-small text-foreground-muted mt-1">{text.addressNote}</p>
        <p className={`type-label mt-3 ${USER_NAME_CONTAINER_CLASS}`}>
          <UserName>{address.recipientName}</UserName> {address.phone}
        </p>
        <p className={`type-body text-foreground-secondary ${USER_NAME_CONTAINER_CLASS}`}>
          <UserName>{address.line1}</UserName> <UserName>{address.subdistrict}</UserName>{" "}
          <UserName>{address.district}</UserName> <UserName>{address.province}</UserName>{" "}
          {address.postalCode}
        </p>
      </Card>

      {order.sellerOrders.map((part) => {
        const headingId = `store-order-${part.id}`;
        const shipment = part.shipment;
        return (
          <Card as="section" key={part.id} padding="panel" aria-labelledby={headingId}>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle as="h2" size="panel" id={headingId} className={USER_NAME_CONTAINER_CLASS}>
                <UserName>{part.storeName}</UserName>
              </CardTitle>
              <PartStatus part={part} />
            </div>
            {part.cancellationKind === "REFUND_OUTSIDE_SYSTEM" ? (
              <p className="type-small text-foreground-secondary mt-1">{text.refundOutsideNote}</p>
            ) : null}
            <dl className="mt-3 grid gap-2 sm:grid-cols-[max-content_1fr] sm:gap-x-8">
              <Row label={text.partStore}>{part.storeId}</Row>
              <Row label={text.commission}>
                {fill(text.commissionValue, { percent: percentOf(part.commissionRateBps) })}
              </Row>
            </dl>

            <ul aria-label={text.itemsLabel} className="mt-4">
              {part.items.map((item) => (
                <li
                  key={item.id}
                  className="border-border flex gap-4 border-t py-4 first:border-t-0"
                >
                  <div className="w-16 shrink-0 sm:w-20">
                    <ProductImage image={item.image} alt="" sizes="80px" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className={`type-card-title ${USER_NAME_CONTAINER_CLASS}`}>
                      <UserName>{item.productTitle}</UserName>
                    </p>
                    <p className="type-body text-foreground-secondary">
                      <Price satang={item.unitPriceSatang} /> {th.seller.common.timesSign}{" "}
                      {fill(text.pieces, { count: formatCount(item.quantity) })}
                    </p>
                    <p className="type-label">
                      <span className="text-foreground-secondary">{text.lineTotal} </span>
                      <Price satang={item.lineTotalSatang} />
                    </p>
                  </div>
                </li>
              ))}
            </ul>

            <dl className="border-border mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t pt-3">
              <dt className="type-small text-foreground-secondary">{text.subtotal}</dt>
              <dd className="type-small text-right">
                <Price satang={part.itemsSubtotalSatang} />
              </dd>
              <dt className="type-small text-foreground-secondary">
                {text.shipping}{" "}
                {part.shippingFeeIsSimulated ? (
                  <NoticeLabel>{th.notice.simulatedShipping}</NoticeLabel>
                ) : null}
              </dt>
              <dd className="type-small text-right">
                <Price satang={part.shippingFeeSatang} />
              </dd>
            </dl>

            <div className="mt-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="type-card-title">{text.shipmentTitle}</h3>
                <NoticeLabel>{th.notice.simulatedShipping}</NoticeLabel>
              </div>
              {shipment === null ? (
                <p className="type-body text-foreground-secondary mt-2">{text.noShipment}</p>
              ) : (
                <dl className="mt-2 grid gap-2 sm:grid-cols-[max-content_1fr] sm:gap-x-8">
                  <Row label={text.carrier}>
                    {shipment.carrierName ? (
                      <UserName>{shipment.carrierName}</UserName>
                    ) : (
                      th.admin.common.notProvided
                    )}
                  </Row>
                  <Row label={text.tracking}>
                    {shipment.trackingNumber ? (
                      <UserName>{shipment.trackingNumber}</UserName>
                    ) : (
                      th.admin.common.notProvided
                    )}
                  </Row>
                  <Row label={text.shippedAt}>{formatDateTime(shipment.shippedAt)}</Row>
                  {shipment.deliveredAt !== null ? (
                    <Row label={text.deliveredAt}>{formatDateTime(shipment.deliveredAt)}</Row>
                  ) : null}
                </dl>
              )}
              <p className="type-small text-foreground-muted mt-2">{text.shipmentSimulated}</p>
            </div>

            <PartActions order={order} part={part} />
          </Card>
        );
      })}

      <Card as="section" padding="panel" aria-labelledby="order-totals-title">
        <CardTitle as="h2" size="panel" id="order-totals-title">
          {text.totalsTitle}
        </CardTitle>
        <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
          <dt className="type-body text-foreground-secondary">{text.itemsSubtotal}</dt>
          <dd className="type-body text-right">
            <Price satang={order.itemsSubtotalSatang} />
          </dd>
          <dt className="type-body text-foreground-secondary">
            {text.shippingTotal} <NoticeLabel>{th.notice.simulatedShipping}</NoticeLabel>
          </dt>
          <dd className="type-body text-right">
            <Price satang={order.shippingTotalSatang} />
          </dd>
          <dt className="type-label border-border border-t pt-3">{text.grandTotal}</dt>
          <dd className="border-border border-t pt-3 text-right">
            <Price satang={order.grandTotalSatang} size="card" />
          </dd>
        </dl>
      </Card>

      <div>
        <Link href={ADMIN_ROUTES.orders} className={buttonVariants({ variant: "secondary" })}>
          {text.backToList}
        </Link>
      </div>
    </div>
  );
}

/**
 * Server Component: one order with every seller order through the module service. An id that
 * cannot be one is the same not-found as an unknown id, without a service call.
 */
export async function OrderSection({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return renderForAdmin(
    adminOrderHref(id),
    async (actor) => {
      const parsed = idParamsSchema.safeParse({ id });
      if (!parsed.success) throw notFound();
      return <OrderDetailView order={await getOrder(actor, parsed.data.id)} />;
    },
    {
      notFound: (
        <AdminNotFoundState backHref={ADMIN_ROUTES.orders} backLabel={th.admin.orders.backToList} />
      ),
    },
  );
}
