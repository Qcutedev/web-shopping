import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { th } from "@/i18n/th";
import type { FulfilmentStatusValue, PaymentStatusValue } from "@/modules/orders/state";

// Tones follow the status badge mapping of docs/DESIGN_SYSTEM.md. The label is always shown:
// colour only supports it.

const PAYMENT_VARIANT: Record<PaymentStatusValue, BadgeVariant> = {
  PENDING: "warning",
  PAID: "success",
  FAILED: "danger",
};

function paymentLabel(status: PaymentStatusValue): string {
  // The mark on a failed order is the approved text (D-028, Q35 (a)).
  return status === "FAILED" ? th.order.paymentFailed : th.orders.status.payment[status];
}

export function PaymentBadge({ status }: { status: PaymentStatusValue }) {
  return <Badge variant={PAYMENT_VARIANT[status]}>{paymentLabel(status)}</Badge>;
}

const FULFILMENT_VARIANT: Record<FulfilmentStatusValue, BadgeVariant> = {
  PENDING: "neutral",
  PROCESSING: "info",
  SHIPPED: "shipped",
  DELIVERED: "success",
  CANCELLED: "danger",
};

export function FulfilmentBadge({ status }: { status: FulfilmentStatusValue }) {
  return <Badge variant={FULFILMENT_VARIANT[status]}>{th.orders.status.fulfilment[status]}</Badge>;
}
