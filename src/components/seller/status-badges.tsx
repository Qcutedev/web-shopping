import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { th } from "@/i18n/th";
import type { ProductStatusValue, ModerationStatusValue } from "@/modules/inventory/state";
import type { FulfilmentStatusValue, PaymentStatusValue } from "@/modules/orders/state";
import type { ApplicationStatusValue, StoreStatusValue } from "@/modules/sellers/state";

// Tones follow the status badge mapping of docs/DESIGN_SYSTEM.md. The label is always shown:
// colour only supports it.

const FULFILMENT_VARIANT: Record<FulfilmentStatusValue, BadgeVariant> = {
  PENDING: "neutral",
  PROCESSING: "info",
  SHIPPED: "shipped",
  DELIVERED: "success",
  CANCELLED: "danger",
};

export function FulfilmentBadge({ status }: { status: FulfilmentStatusValue }) {
  return <Badge variant={FULFILMENT_VARIANT[status]}>{th.seller.status.fulfilment[status]}</Badge>;
}

const PAYMENT_VARIANT: Record<PaymentStatusValue, BadgeVariant> = {
  PENDING: "warning",
  PAID: "success",
  FAILED: "danger",
};

export function PaymentBadge({ status }: { status: PaymentStatusValue }) {
  return <Badge variant={PAYMENT_VARIANT[status]}>{th.seller.status.payment[status]}</Badge>;
}

const PRODUCT_VARIANT: Record<ProductStatusValue, BadgeVariant> = {
  DRAFT: "neutral",
  PUBLISHED: "success",
  ARCHIVED: "neutral",
};

export function ProductStatusBadge({ status }: { status: ProductStatusValue }) {
  return <Badge variant={PRODUCT_VARIANT[status]}>{th.seller.status.product[status]}</Badge>;
}

const MODERATION_VARIANT: Record<ModerationStatusValue, BadgeVariant> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  TAKEN_DOWN: "danger",
};

export function ModerationBadge({ status }: { status: ModerationStatusValue }) {
  return <Badge variant={MODERATION_VARIANT[status]}>{th.seller.status.moderation[status]}</Badge>;
}

const STORE_VARIANT: Record<StoreStatusValue, BadgeVariant> = {
  APPROVED: "success",
  SUSPENDED: "danger",
};

export function StoreStatusBadge({ status }: { status: StoreStatusValue }) {
  return <Badge variant={STORE_VARIANT[status]}>{th.seller.status.store[status]}</Badge>;
}

const APPLICATION_VARIANT: Record<ApplicationStatusValue, BadgeVariant> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

export function ApplicationBadge({ status }: { status: ApplicationStatusValue }) {
  return (
    <Badge variant={APPLICATION_VARIANT[status]}>{th.seller.status.application[status]}</Badge>
  );
}
