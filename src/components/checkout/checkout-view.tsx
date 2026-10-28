"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { ShopRequestError } from "@/components/cart/request-error";
import { CartSummary } from "@/components/cart/cart-summary";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { NoticeLabel } from "@/components/ui/notice-label";
import { Price } from "@/components/ui/price";
import { Radio, RadioGroup } from "@/components/ui/radio";
import { USER_NAME_CONTAINER_CLASS, UserName } from "@/components/user-name";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { readCart } from "@/lib/api-client/cart";
import {
  type CheckoutRefusal,
  isSafeToResend,
  isUnknownOutcome,
  newIdempotencyKey,
  placeOrder,
  readCheckoutRefusal,
} from "@/lib/api-client/checkout";
import type { ApiFailure } from "@/lib/api-client/http";
import { orderHref, ROUTES } from "@/lib/routes";
import type { CartDto, CartLineDto } from "@/modules/cart/schema";
import type { AddressDto } from "@/modules/profile/schema";

type Failure = Pick<ApiFailure, "status" | "code" | "reason">;

function lineOf(cart: CartDto, productId: string): CartLineDto | null {
  for (const group of cart.stores) {
    for (const line of group.items) if (line.productId === productId) return line;
  }
  return null;
}

function refusalLine(
  cart: CartDto,
  entry: CheckoutRefusal["items"][number],
): { key: string; line: CartLineDto | null; text: string } {
  const line = lineOf(cart, entry.productId);
  const key = `${entry.cartItemId ?? "none"}-${entry.productId}-${entry.reason}`;
  if (entry.reason === "NOT_AVAILABLE") {
    return { key, line, text: th.checkout.refusedNotAvailable };
  }
  if (entry.reason === "OWN_STORE") {
    return { key, line, text: th.checkout.refusedOwnStore };
  }
  if (entry.availableStock === null) {
    // The server gave no stock figure: say only that stock is short, never "sold out".
    return { key, line, text: th.errors.insufficientStock };
  }
  if (entry.availableStock < 1) {
    return { key, line, text: th.checkout.refusedSoldOut };
  }
  // The owner-approved text of a lowered quantity (D-026 OQ-46).
  return { key, line, text: fill(th.quantity.lowered, { available: entry.availableStock }) };
}

/**
 * Checkout (REQ-C-11, REQ-C-12, BR-20, BR-22, BR-30). The client sends the address id and the
 * payment method only (a mock: no money moves); every amount shown is the server's. One
 * `Idempotency-Key` is made per attempt and kept while the outcome is unknown, so a retry returns
 * the same order instead of making a second one. After a refusal the customer reads the new
 * quantities and total and confirms again with a new key; nothing is resent automatically
 * (API_CONTRACTS 5.5.3).
 */
export function CheckoutView({
  cart,
  addresses,
}: {
  cart: CartDto;
  addresses: readonly AddressDto[];
}) {
  const router = useRouter();
  const initial = addresses.find((entry) => entry.isDefault) ?? addresses[0] ?? null;
  const [addressId, setAddressId] = useState<string | null>(initial?.id ?? null);
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [refusal, setRefusal] = useState<CheckoutRefusal | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [changedNote, setChangedNote] = useState(false);
  // One key per attempt; kept only while the outcome of the request is unknown.
  const keyRef = useRef<string | null>(null);
  const busyRef = useRef(false);

  const selectedId = addresses.some((entry) => entry.id === addressId) ? addressId : null;

  async function send() {
    if (busyRef.current) return;
    if (selectedId === null) {
      setAddressError(th.checkout.addressRequired);
      return;
    }
    busyRef.current = true;
    setPending(true);
    setAddressError(null);
    setFailure(null);
    setRefusal(null);
    setChangedNote(false);
    const key = keyRef.current ?? newIdempotencyKey();
    keyRef.current = key;
    const response = await placeOrder(
      {
        addressId: selectedId,
        paymentMethod: "MOCK",
        mockOutcome: simulateFailure ? "FAIL" : "SUCCESS",
      },
      key,
    );
    if (response.ok) {
      // The order exists, paid or failed; the order page tells which. Stay disabled while leaving.
      keyRef.current = null;
      setUnknown(false);
      router.push(orderHref(response.data.id));
      return;
    }
    busyRef.current = false;
    setPending(false);
    if (isUnknownOutcome(response)) {
      // The unknown-outcome notice says it all; a second banner would repeat it.
      setUnknown(true);
      return;
    }
    // A decision of the server: the next attempt is a new customer decision with a new key.
    keyRef.current = null;
    setUnknown(false);
    if (response.status === 409) {
      const refused = readCheckoutRefusal(response);
      if (refused !== null) {
        setRefusal(refused);
        router.refresh();
        return;
      }
      router.refresh();
    } else if (response.status === 404) {
      // The address (or cart) is gone: show the lists as they are now.
      router.refresh();
    }
    setFailure(response);
  }

  async function checkStatus() {
    if (busyRef.current) return;
    busyRef.current = true;
    setPending(true);
    setFailure(null);
    const current = await readCart();
    busyRef.current = false;
    setPending(false);
    if (!current.ok) {
      setFailure(current);
      return;
    }
    if (isSafeToResend(current.data, cart)) {
      // The same key: an order that was placed is returned, none is made twice.
      await send();
      return;
    }
    keyRef.current = null;
    setUnknown(false);
    setChangedNote(true);
    router.refresh();
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (unknown) return;
    void send();
  }

  if (cart.stores.length === 0 && refusal === null && !unknown) {
    return (
      <EmptyState
        title={th.checkout.emptyTitle}
        description={th.checkout.emptyDescription}
        action={
          <Link href={ROUTES.home} className={buttonVariants({ variant: "primary" })}>
            {th.checkout.emptyAction}
          </Link>
        }
      />
    );
  }

  const header = (
    <>
      {failure ? <ShopRequestError failure={failure} returnTo={ROUTES.checkout} /> : null}
      {changedNote ? (
        <Alert tone="warning" title={th.checkout.refusedTitle}>
          {th.checkout.unknownChanged}
        </Alert>
      ) : null}
      {unknown ? (
        <Alert
          tone="warning"
          title={th.checkout.unknownTitle}
          action={
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                size="sm"
                loading={pending}
                onClick={() => void checkStatus()}
              >
                {th.checkout.unknownCheck}
              </Button>
              <Link
                href={ROUTES.orders}
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                {th.checkout.viewOrders}
              </Link>
            </div>
          }
        >
          {th.checkout.unknownBody}
        </Alert>
      ) : null}
      {refusal ? (
        <Alert tone="warning" title={th.checkout.refusedTitle}>
          <p>{th.checkout.refusedBody}</p>
          <ul aria-label={th.checkout.refusedListLabel} className="mt-2 list-disc ps-5">
            {refusal.items.map((entry) => {
              const item = refusalLine(cart, entry);
              return (
                <li key={item.key} className={USER_NAME_CONTAINER_CLASS}>
                  {item.line?.title ? (
                    <UserName>{item.line.title}</UserName>
                  ) : item.line ? (
                    // A hidden line has no title (SEC-054): a fixed label instead.
                    th.cart.unavailableLine
                  ) : (
                    th.checkout.refusedUnknownItem
                  )}
                  : {item.text}
                </li>
              );
            })}
          </ul>
          {refusal.totals ? (
            <p className="mt-2">
              {th.checkout.refusedNewTotal} <Price satang={refusal.totals.grandTotalSatang} />
            </p>
          ) : null}
        </Alert>
      ) : null}
    </>
  );

  if (!cart.canCheckout) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <EmptyState
          title={th.checkout.blockedTitle}
          description={th.checkout.blockedDescription}
          action={
            <Link href={ROUTES.cart} className={buttonVariants({ variant: "primary" })}>
              {th.checkout.backToCart}
            </Link>
          }
        />
      </div>
    );
  }

  if (addresses.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <EmptyState
          title={th.checkout.noAddressTitle}
          description={th.checkout.noAddressDescription}
          action={
            <Link href={ROUTES.accountAddresses} className={buttonVariants({ variant: "primary" })}>
              {th.checkout.noAddressAction}
            </Link>
          }
        />
      </div>
    );
  }

  // While the outcome is unknown only "ตรวจสอบสถานะ" may proceed: the key and the body of the
  // first attempt must not change, and a new attempt must not start.
  const locked = pending || unknown;
  const submitLabel = refusal ? th.checkout.confirmAgain : th.checkout.submit;

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-busy={pending || undefined}
      className="grid items-start gap-6 lg:grid-cols-[1fr_24rem]"
    >
      <div className="flex flex-col gap-4">
        {header}

        <Card as="section" padding="panel" aria-labelledby="checkout-address-title">
          <CardTitle as="h2" size="panel" id="checkout-address-title">
            {th.checkout.addressTitle}
          </CardTitle>
          <div className="mt-2">
            <RadioGroup
              legend={th.checkout.addressLegend}
              errorText={addressError ?? undefined}
              disabled={locked}
            >
              {addresses.map((address) => (
                <Radio
                  key={address.id}
                  name="addressId"
                  value={address.id}
                  checked={selectedId === address.id}
                  onChange={() => {
                    setAddressId(address.id);
                    setAddressError(null);
                  }}
                  label={
                    <span className={`flex flex-col ${USER_NAME_CONTAINER_CLASS}`}>
                      <span className="type-label">
                        <UserName>{address.recipientName}</UserName> {address.phone}
                      </span>
                      <span className="type-body text-foreground-secondary">
                        <UserName>{address.line1}</UserName>{" "}
                        <UserName>{address.subdistrict}</UserName>{" "}
                        <UserName>{address.district}</UserName>{" "}
                        <UserName>{address.province}</UserName> {address.postalCode}
                      </span>
                    </span>
                  }
                />
              ))}
            </RadioGroup>
          </div>
          <p className="mt-2">
            <Link href={ROUTES.accountAddresses} className="type-body text-primary underline">
              {th.checkout.manageAddresses}
            </Link>
          </p>
        </Card>

        <Card as="section" padding="panel" aria-labelledby="checkout-shipping-title">
          <CardTitle as="h2" size="panel" id="checkout-shipping-title">
            {th.checkout.shippingTitle} <NoticeLabel>{th.notice.simulatedShipping}</NoticeLabel>
          </CardTitle>
          <p className="type-body text-foreground-secondary mt-2">{th.checkout.shippingNote}</p>
        </Card>

        <Card as="section" padding="panel" aria-labelledby="checkout-payment-title">
          <CardTitle as="h2" size="panel" id="checkout-payment-title">
            {th.checkout.paymentTitle} <NoticeLabel>{th.notice.mockPayment}</NoticeLabel>
          </CardTitle>
          <p className="type-label mt-2">{th.checkout.paymentMock}</p>
          <p className="type-body text-foreground-secondary">{th.checkout.paymentMockNote}</p>
          <Checkbox
            name="simulateFailure"
            label={th.checkout.failOption}
            helperText={th.checkout.failOptionNote}
            checked={simulateFailure}
            onChange={(event) => setSimulateFailure(event.target.checked)}
            disabled={locked}
            wrapperClassName="mt-2"
          />
        </Card>
      </div>

      <div className="flex flex-col gap-4 lg:sticky lg:top-4">
        <CartSummary
          totals={cart}
          heading={th.checkout.summaryTitle}
          headingId="checkout-summary-title"
        >
          <ul aria-label={th.checkout.itemsLabel} className="flex flex-col gap-2">
            {cart.stores.flatMap((group) =>
              group.items
                .filter((line) => line.buyable && line.lineTotalSatang !== null)
                .map((line) => (
                  <li key={line.id} className="flex justify-between gap-3">
                    <span className={`type-body ${USER_NAME_CONTAINER_CLASS}`}>
                      {line.title ? <UserName>{line.title}</UserName> : th.cart.unavailableLine}{" "}
                      {th.seller.common.timesSign} {line.quantity}
                    </span>
                    <Price satang={line.lineTotalSatang ?? 0} />
                  </li>
                )),
            )}
          </ul>
          <Button type="submit" size="lg" fullWidth loading={pending} disabled={unknown}>
            {submitLabel}
          </Button>
          <Link href={ROUTES.cart} className={buttonVariants({ variant: "ghost" })}>
            {th.checkout.backToCart}
          </Link>
        </CartSummary>
      </div>
    </form>
  );
}
