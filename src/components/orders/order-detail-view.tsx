import Link from "next/link";
import type { ReactNode } from "react";
import { ProductImage } from "@/components/catalog/product-image";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { NoticeLabel } from "@/components/ui/notice-label";
import { Price } from "@/components/ui/price";
import { USER_NAME_CONTAINER_CLASS, UserName } from "@/components/user-name";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { formatDateTime } from "@/lib/format";
import { ROUTES, storeHref } from "@/lib/routes";
import type { OrderDto, OrderItemDto } from "@/modules/orders/schema";
import { FulfilmentBadge, PaymentBadge } from "./status-badges";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="type-label text-foreground-secondary">{label}</dt>
      <dd className={USER_NAME_CONTAINER_CLASS}>{children}</dd>
    </>
  );
}

/** The item of this order for a product id, for the cart-return notices. */
function itemIn(order: OrderDto, productId: string): OrderItemDto | null {
  for (const part of order.sellerOrders) {
    for (const item of part.items) if (item.productId === productId) return item;
  }
  return null;
}

/** What the order's payment status means for the customer (BR-20; API_CONTRACTS 5.5.4). */
function PaymentOutcome({ order }: { order: OrderDto }) {
  if (order.paymentStatus === "PAID") {
    return (
      <Alert tone="success" title={th.orders.confirmation.paidTitle}>
        {th.orders.confirmation.paidBody}
      </Alert>
    );
  }
  if (order.paymentStatus === "PENDING") {
    return (
      <Alert tone="info" title={th.orders.confirmation.pendingTitle}>
        {th.orders.confirmation.pendingBody}
      </Alert>
    );
  }
  const timedOut = order.payment.failureReason === "TIMEOUT";
  const capped = order.cartReturn?.items.filter((entry) => entry.capped) ?? [];
  return (
    <Alert
      tone="danger"
      title={th.order.paymentFailed}
      action={
        <Link href={ROUTES.cart} className={buttonVariants({ variant: "secondary", size: "sm" })}>
          {th.orders.confirmation.goToCart}
        </Link>
      }
    >
      <p>
        {timedOut ? th.orders.confirmation.failedTimeoutBody : th.orders.confirmation.failedBody}
      </p>
      {order.cartReturn !== null && order.cartReturn.items.length > 0 ? (
        <>
          <p className="mt-2">{th.orders.detail.cartReturnBody}</p>
          {capped.length > 0 ? (
            <ul className="mt-1 list-disc ps-5">
              {capped.map((entry) => {
                const item = itemIn(order, entry.productId);
                return (
                  <li key={entry.productId} className={USER_NAME_CONTAINER_CLASS}>
                    {item ? (
                      <UserName>{item.productTitle}</UserName>
                    ) : (
                      th.checkout.refusedUnknownItem
                    )}
                    : {fill(th.cart.returnedQuantityCut, { quantity: entry.cartQuantity })}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </>
      ) : null}
    </Alert>
  );
}

/**
 * One order of the signed-in customer as the server returned it (REQ-C-12, REQ-C-13, BR-09,
 * BR-20, BR-39). Every amount is a copy stored at purchase. The payment is a mock and the
 * shipping is simulated, and both are labelled.
 */
export function OrderDetailView({ order }: { order: OrderDto }) {
  const detail = th.orders.detail;
  const address = order.shippingAddress;
  return (
    <div className="flex flex-col gap-6">
      <PaymentOutcome order={order} />

      <Card as="section" padding="panel" aria-labelledby="order-summary-title">
        <CardTitle as="h2" size="panel" id="order-summary-title">
          {detail.summaryTitle}
        </CardTitle>
        <dl className="mt-4 grid gap-4 sm:grid-cols-[max-content_1fr] sm:gap-x-8">
          <Row label={th.orders.orderNumber}>{order.orderNumber}</Row>
          <Row label={th.orders.placedAt}>{formatDateTime(order.createdAt)}</Row>
          <Row label={detail.payment}>
            <span className="flex flex-wrap items-center gap-2">
              <PaymentBadge status={order.paymentStatus} />
              {order.payment.isSimulated ? (
                <NoticeLabel>{th.notice.mockPayment}</NoticeLabel>
              ) : null}
            </span>
          </Row>
          {/* The only provider is the mock (API_CONTRACTS 1.9): its label, never the raw name. */}
          <Row label={detail.paymentMethod}>{detail.paymentMock}</Row>
          {order.paidAt !== null ? (
            <Row label={detail.paidAt}>{formatDateTime(order.paidAt)}</Row>
          ) : null}
        </dl>
      </Card>

      <Card as="section" padding="panel" aria-labelledby="order-address-title">
        <CardTitle as="h2" size="panel" id="order-address-title">
          {detail.addressTitle}
        </CardTitle>
        <p className="type-small text-foreground-muted mt-1">{detail.addressNote}</p>
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
                <Link href={storeHref(part.storeSlug)} className="hover:underline">
                  <UserName>{part.storeName}</UserName>
                </Link>
              </CardTitle>
              <FulfilmentBadge status={part.fulfilmentStatus} />
            </div>
            {part.cancellationKind === "PAYMENT_FAILED" ? (
              <p className="type-small text-foreground-secondary mt-1">
                {detail.cancelledPaymentFailed}
              </p>
            ) : null}

            <ul aria-label={detail.itemsLabel} className="mt-4">
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
                      {fill(detail.pieces, { count: item.quantity })}
                    </p>
                    <p className="type-label">
                      <span className="text-foreground-secondary">{detail.lineTotal} </span>
                      <Price satang={item.lineTotalSatang} />
                    </p>
                  </div>
                </li>
              ))}
            </ul>

            <dl className="border-border mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t pt-3">
              <dt className="type-small text-foreground-secondary">{detail.storeSubtotal}</dt>
              <dd className="type-small text-right">
                <Price satang={part.itemsSubtotalSatang} />
              </dd>
              <dt className="type-small text-foreground-secondary">
                {detail.storeShipping}{" "}
                {part.shippingFeeIsSimulated ? (
                  <NoticeLabel>{th.notice.simulatedShipping}</NoticeLabel>
                ) : null}
              </dt>
              <dd className="type-small text-right">
                <Price satang={part.shippingFeeSatang} />
              </dd>
            </dl>

            {shipment !== null ? (
              <div className="mt-4">
                <h3 className="type-card-title">
                  {detail.shipmentTitle}{" "}
                  {shipment.isSimulated ? (
                    <NoticeLabel>{th.notice.simulatedShipping}</NoticeLabel>
                  ) : null}
                </h3>
                <dl className="mt-2 grid gap-2 sm:grid-cols-[max-content_1fr] sm:gap-x-8">
                  <Row label={detail.carrier}>{shipment.carrierName ?? detail.notProvided}</Row>
                  <Row label={detail.tracking}>{shipment.trackingNumber ?? detail.notProvided}</Row>
                  <Row label={detail.shippedAt}>{formatDateTime(shipment.shippedAt)}</Row>
                  {shipment.deliveredAt !== null ? (
                    <Row label={detail.deliveredAt}>{formatDateTime(shipment.deliveredAt)}</Row>
                  ) : null}
                </dl>
                {shipment.isSimulated ? (
                  <p className="type-small text-foreground-muted mt-2">
                    {detail.shipmentSimulated}
                  </p>
                ) : null}
              </div>
            ) : null}
          </Card>
        );
      })}

      <Card as="section" padding="panel" aria-labelledby="order-totals-title">
        <CardTitle as="h2" size="panel" id="order-totals-title">
          {th.orders.total}
        </CardTitle>
        <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
          <dt className="type-body text-foreground-secondary">{detail.itemsSubtotal}</dt>
          <dd className="type-body text-right">
            <Price satang={order.itemsSubtotalSatang} />
          </dd>
          <dt className="type-body text-foreground-secondary">
            {detail.shippingTotal} <NoticeLabel>{th.notice.simulatedShipping}</NoticeLabel>
          </dt>
          <dd className="type-body text-right">
            <Price satang={order.shippingTotalSatang} />
          </dd>
          <dt className="type-label border-border border-t pt-3">{detail.grandTotal}</dt>
          <dd className="border-border border-t pt-3 text-right">
            <Price satang={order.grandTotalSatang} size="card" />
          </dd>
        </dl>
      </Card>

      <div>
        <Link href={ROUTES.orders} className={buttonVariants({ variant: "secondary" })}>
          {th.orders.backToList}
        </Link>
      </div>
    </div>
  );
}
