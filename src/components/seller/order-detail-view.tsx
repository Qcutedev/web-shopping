import type { ReactNode } from "react";
import { ProductImage } from "@/components/catalog/product-image";
import { Alert } from "@/components/ui/alert";
import { Card, CardTitle } from "@/components/ui/card";
import { NoticeLabel } from "@/components/ui/notice-label";
import { Price } from "@/components/ui/price";
import { USER_NAME_CONTAINER_CLASS, UserName } from "@/components/user-name";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { formatDateTime } from "@/lib/format";
import type { SellerOrderViewDto } from "@/modules/orders/seller-schema";
import { OrderStatusPanel } from "./order-status-panel";
import { FulfilmentBadge, PaymentBadge } from "./status-badges";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="type-label text-foreground-secondary">{label}</dt>
      <dd className={USER_NAME_CONTAINER_CLASS}>{children}</dd>
    </>
  );
}

/**
 * One seller order as the server returned it (REQ-S-07, REQ-S-08): the store's own portion, the
 * buyer's shipping copy, the paid time (BR-39), and the status controls. The amounts are the
 * stored copies taken at purchase; no total across stores is shown or computed.
 */
export function OrderDetailView({ order }: { order: SellerOrderViewDto }) {
  const detail = th.seller.orders.detail;
  const address = order.shippingAddress;
  const shipment = order.shipment;

  return (
    <div className="flex flex-col gap-6">
      <Card as="section" padding="panel" aria-labelledby="order-summary-title">
        <CardTitle as="h2" size="panel" id="order-summary-title">
          {detail.summaryTitle}
        </CardTitle>
        <dl className="mt-4 grid gap-4 sm:grid-cols-[max-content_1fr] sm:gap-x-8">
          <Row label={detail.orderNumber}>{order.orderNumber}</Row>
          <Row label={detail.placedAt}>{formatDateTime(order.createdAt)}</Row>
          <Row label={detail.paidAt}>{formatDateTime(order.paidAt)}</Row>
          <Row label={detail.payment}>
            <PaymentBadge status={order.paymentStatus} />
          </Row>
          <Row label={detail.fulfilment}>
            <FulfilmentBadge status={order.fulfilmentStatus} />
          </Row>
          <Row label={detail.storeName}>
            <UserName>{order.storeName}</UserName>
          </Row>
        </dl>
        {order.cancellationKind !== null ? (
          <Alert tone="danger" className="mt-4" role="note">
            {detail.cancelledNote}
          </Alert>
        ) : null}
      </Card>

      <OrderStatusPanel orderId={order.id} status={order.fulfilmentStatus} />

      <Card as="section" padding="panel" aria-labelledby="order-items-title">
        <CardTitle as="h2" size="panel" id="order-items-title">
          {detail.itemsTitle}
        </CardTitle>
        <ul aria-label={detail.itemsLabel} className="mt-4 flex flex-col gap-4">
          {order.items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-start gap-3">
              <ProductImage image={item.image} alt="" sizes="64px" className="size-16 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className={`type-label ${USER_NAME_CONTAINER_CLASS}`}>
                  <UserName>{item.productTitle}</UserName>
                </p>
                <p className={`type-small text-foreground-secondary ${USER_NAME_CONTAINER_CLASS}`}>
                  {detail.sku}: <UserName>{item.productSku}</UserName>
                </p>
                <p className="type-small text-foreground-secondary">
                  <Price satang={item.unitPriceSatang} /> {" × "}
                  {fill(detail.pieces, { count: item.quantity })}
                </p>
              </div>
              <p className="type-label">
                <span className="sr-only">{detail.lineTotal}: </span>
                <Price satang={item.lineTotalSatang} />
              </p>
            </li>
          ))}
        </ul>
        <dl className="border-border mt-4 grid gap-2 border-t pt-4 sm:grid-cols-[1fr_max-content] sm:gap-x-8">
          <dt className="type-label">{detail.subtotal}</dt>
          <dd className="type-label">
            <Price satang={order.itemsSubtotalSatang} />
          </dd>
          <dt className="type-body flex flex-wrap items-center gap-2">
            {detail.shippingFee}
            {order.shippingFeeIsSimulated ? (
              <NoticeLabel>{th.notice.simulatedShipping}</NoticeLabel>
            ) : null}
          </dt>
          <dd className="type-body">
            <Price satang={order.shippingFeeSatang} />
          </dd>
        </dl>
        <p className="type-small text-foreground-muted mt-2">{detail.totalsNote}</p>
      </Card>

      <Card as="section" padding="panel" aria-labelledby="order-buyer-title">
        <CardTitle as="h2" size="panel" id="order-buyer-title">
          {detail.buyerTitle}
        </CardTitle>
        <dl className="mt-4 grid gap-4 sm:grid-cols-[max-content_1fr] sm:gap-x-8">
          <Row label={detail.recipient}>
            <UserName>{address.recipientName}</UserName>
          </Row>
          <Row label={detail.phone}>{address.phone}</Row>
          <Row label={detail.address}>
            <UserName>{address.line1}</UserName> <UserName>{address.subdistrict}</UserName>{" "}
            <UserName>{address.district}</UserName> <UserName>{address.province}</UserName>{" "}
            {address.postalCode}
          </Row>
        </dl>
      </Card>

      <Card as="section" padding="panel" aria-labelledby="order-shipment-title">
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle as="h2" size="panel" id="order-shipment-title">
            {detail.shipmentTitle}
          </CardTitle>
          <NoticeLabel>{th.notice.simulatedShipping}</NoticeLabel>
        </div>
        {shipment === null ? (
          <p className="type-body text-foreground-secondary mt-4">{detail.noShipment}</p>
        ) : (
          <dl className="mt-4 grid gap-4 sm:grid-cols-[max-content_1fr] sm:gap-x-8">
            <Row label={detail.carrier}>
              {shipment.carrierName ? (
                <UserName>{shipment.carrierName}</UserName>
              ) : (
                detail.notProvided
              )}
            </Row>
            <Row label={detail.tracking}>
              {shipment.trackingNumber ? (
                <UserName>{shipment.trackingNumber}</UserName>
              ) : (
                detail.notProvided
              )}
            </Row>
            <Row label={detail.shippedAt}>{formatDateTime(shipment.shippedAt)}</Row>
            {shipment.deliveredAt ? (
              <Row label={detail.deliveredAt}>{formatDateTime(shipment.deliveredAt)}</Row>
            ) : null}
          </dl>
        )}
        <p className="type-small text-foreground-muted mt-4">{detail.simulatedNote}</p>
      </Card>
    </div>
  );
}
