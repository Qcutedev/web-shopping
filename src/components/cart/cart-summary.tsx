import type { ReactNode } from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { NoticeLabel } from "@/components/ui/notice-label";
import { Price } from "@/components/ui/price";
import { th } from "@/i18n/th";

export interface CartTotals {
  itemsSubtotalSatang: number;
  shippingTotalSatang: number;
  grandTotalSatang: number;
}

/**
 * The totals of a cart exactly as the server computed them. Nothing is added or multiplied here;
 * the shipping line is marked as simulated (BR-08, API_CONTRACTS 1.9). `children` is the action
 * under the totals.
 */
export function CartSummary({
  totals,
  heading,
  headingId,
  children,
}: {
  totals: CartTotals;
  heading: string;
  headingId: string;
  children?: ReactNode;
}) {
  return (
    <Card as="section" padding="panel" aria-labelledby={headingId} className="flex flex-col gap-4">
      <CardTitle as="h2" size="panel" id={headingId}>
        {heading}
      </CardTitle>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
        <dt className="type-body text-foreground-secondary">{th.cart.itemsSubtotal}</dt>
        <dd className="type-body text-right">
          <Price satang={totals.itemsSubtotalSatang} />
        </dd>
        <dt className="type-body text-foreground-secondary">
          {th.cart.shippingTotal} <NoticeLabel>{th.notice.simulatedShipping}</NoticeLabel>
        </dt>
        <dd className="type-body text-right">
          <Price satang={totals.shippingTotalSatang} />
        </dd>
        <dt className="type-label border-border border-t pt-3">{th.cart.grandTotal}</dt>
        <dd className="border-border border-t pt-3 text-right">
          <Price satang={totals.grandTotalSatang} size="card" />
        </dd>
      </dl>
      <p className="type-small text-foreground-muted">{th.cart.shippingSimulatedNote}</p>
      <p className="type-small text-foreground-muted">{th.cart.totalsNote}</p>
      {children}
    </Card>
  );
}
