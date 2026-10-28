"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ProductImage } from "@/components/catalog/product-image";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Price } from "@/components/ui/price";
import { QuantityStepper } from "@/components/ui/quantity-stepper";
import { USER_NAME_CONTAINER_CLASS, UserName } from "@/components/user-name";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { removeCartItem, setCartItemQuantity } from "@/lib/api-client/cart";
import type { ApiFailure, ApiResult } from "@/lib/api-client/http";
import { productHref, ROUTES } from "@/lib/routes";
import type { CartDto, CartLineDto, CartStoreGroupDto } from "@/modules/cart/schema";
import { MAX_LINE_QUANTITY } from "@/modules/cart/schema";
import { CartSummary } from "./cart-summary";
import { ShopRequestError } from "./request-error";

type Failure = Pick<ApiFailure, "status" | "code" | "reason">;

/**
 * The cart as the server returned it (REQ-C-10, BR-22, BR-30, BR-38). The client sends a quantity
 * and nothing else; every price, line total, fee, and total shown is from `cart`. After a change
 * the page is refreshed so the numbers shown are the server's, not a guess made here.
 */
export function CartView({ cart }: { cart: CartDto }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  if (cart.stores.length === 0) {
    return (
      <EmptyState
        title={th.cart.emptyTitle}
        description={th.cart.emptyDescription}
        action={
          <Link href={ROUTES.home} className={buttonVariants({ variant: "primary" })}>
            {th.cart.emptyAction}
          </Link>
        }
      />
    );
  }

  async function change(itemId: string, run: () => Promise<ApiResult<unknown>>, done: string) {
    if (busyId !== null) return;
    setNotice(null);
    setFailure(null);
    setBusyId(itemId);
    const response = await run();
    setBusyId(null);
    if (response.ok) {
      setNotice(done);
      router.refresh();
      return;
    }
    // The line or its product changed under the customer: show the cart as it is now.
    if (response.status === 404 || response.status === 409) router.refresh();
    setFailure(response);
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-4">
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {failure ? <ShopRequestError failure={failure} returnTo={ROUTES.cart} /> : null}
        {cart.stores.map((group) => (
          <StoreGroup
            key={group.store.slug}
            group={group}
            busyId={busyId}
            onQuantity={(line, quantity) =>
              void change(
                line.id,
                () => setCartItemQuantity(line.id, quantity),
                th.cart.quantityUpdated,
              )
            }
            onRemove={(line) =>
              void change(line.id, () => removeCartItem(line.id), th.cart.removed)
            }
          />
        ))}
      </div>
      <div className="flex flex-col gap-4 lg:sticky lg:top-4">
        <CartSummary totals={cart} heading={th.cart.summaryTitle} headingId="cart-summary-title">
          {cart.canCheckout ? (
            <Link href={ROUTES.checkout} className={buttonVariants({ variant: "primary" })}>
              {th.cart.checkout}
            </Link>
          ) : (
            <>
              <Alert tone="warning" role="note">
                {th.cart.blockedNote}
              </Alert>
              <Button disabled>{th.cart.checkout}</Button>
            </>
          )}
        </CartSummary>
      </div>
    </div>
  );
}

function StoreGroup({
  group,
  busyId,
  onQuantity,
  onRemove,
}: {
  group: CartStoreGroupDto;
  busyId: string | null;
  onQuantity: (line: CartLineDto, quantity: number) => void;
  onRemove: (line: CartLineDto) => void;
}) {
  const headingId = `store-${group.store.slug}`;
  return (
    <Card as="section" padding="panel" aria-labelledby={headingId} className="flex flex-col gap-4">
      <CardTitle as="h2" id={headingId} className={USER_NAME_CONTAINER_CLASS}>
        <UserName>{group.store.name}</UserName>
      </CardTitle>
      <ul aria-label={fill(th.cart.storeGroupLabel, { name: group.store.name })}>
        {group.items.map((line) => (
          <li key={line.id} className="border-border border-t py-4 first:border-t-0 first:pt-0">
            <CartLine
              line={line}
              busy={busyId === line.id}
              disabled={busyId !== null}
              onQuantity={onQuantity}
              onRemove={onRemove}
            />
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
        <dt className="type-small text-foreground-secondary">{th.cart.storeSubtotal}</dt>
        <dd className="type-small text-right">
          <Price satang={group.itemsSubtotalSatang} />
        </dd>
        <dt className="type-small text-foreground-secondary">{th.cart.storeShipping}</dt>
        <dd className="type-small text-right">
          <Price satang={group.shippingFeeSatang} />
        </dd>
      </dl>
    </Card>
  );
}

function CartLine({
  line,
  busy,
  disabled,
  onQuantity,
  onRemove,
}: {
  line: CartLineDto;
  busy: boolean;
  disabled: boolean;
  onQuantity: (line: CartLineDto, quantity: number) => void;
  onRemove: (line: CartLineDto) => void;
}) {
  const noteId = `line-note-${line.id}`;
  // The product title names the stepper group and the remove button by reference, so no title is
  // copied into an attribute (SEC-057).
  const titleId = `line-title-${line.id}`;
  const removeId = `line-remove-${line.id}`;
  const max = Math.min(line.stock ?? 0, MAX_LINE_QUANTITY);
  const unbuyable = !line.buyable;
  const note = unbuyable
    ? line.unbuyableReason === "SOLD_OUT"
      ? th.cart.soldOutNote
      : th.cart.notAvailableNote
    : line.quantityLowered && line.stock !== null
      ? fill(th.quantity.lowered, { available: line.stock })
      : null;

  return (
    <div className="flex gap-4">
      <div className="w-20 shrink-0 sm:w-24">
        <ProductImage image={line.image} alt="" sizes="96px" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {line.slug !== null && line.title !== null ? (
            <Link
              id={titleId}
              href={productHref(line.slug)}
              className={`type-card-title hover:underline ${USER_NAME_CONTAINER_CLASS}`}
            >
              <UserName>{line.title}</UserName>
            </Link>
          ) : (
            // A NOT_AVAILABLE line has no slug, title, or picture (SEC-054): a fixed label instead.
            <span id={titleId} className="type-card-title">
              {th.cart.unavailableLine}
            </span>
          )}
          {unbuyable ? (
            <Badge variant="danger">
              {line.unbuyableReason === "SOLD_OUT" ? th.cart.soldOut : th.cart.notAvailable}
            </Badge>
          ) : null}
        </div>

        {line.unitPriceSatang !== null ? (
          <p className="type-body text-foreground-secondary">
            {th.cart.unitPrice} <Price satang={line.unitPriceSatang} />
          </p>
        ) : null}

        {note ? (
          <Alert tone={unbuyable ? "warning" : "info"} role="note" id={noteId}>
            {note}
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          {unbuyable ? null : (
            <div role="group" aria-labelledby={titleId}>
              <QuantityStepper
                value={line.quantity}
                max={max}
                onChange={(quantity) => {
                  if (quantity !== line.quantity) onQuantity(line, quantity);
                }}
                inputLabel={th.cart.quantity}
                decreaseLabel={th.cart.decrease}
                increaseLabel={th.cart.increase}
                disabled={disabled}
                aria-describedby={note ? noteId : undefined}
              />
            </div>
          )}
          {line.lineTotalSatang !== null && !unbuyable ? (
            <p className="type-label">
              <span className="text-foreground-secondary">{th.cart.lineTotal} </span>
              <Price satang={line.lineTotalSatang} size="card" />
            </p>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            loading={busy}
            disabled={disabled && !busy}
            id={removeId}
            aria-labelledby={`${removeId} ${titleId}`}
            onClick={() => onRemove(line)}
          >
            {th.cart.remove}
          </Button>
        </div>
      </div>
    </div>
  );
}
