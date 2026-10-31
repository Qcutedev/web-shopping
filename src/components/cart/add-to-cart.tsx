"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RequestError } from "@/components/account/request-error";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { QuantityStepper } from "@/components/ui/quantity-stepper";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { addCartItem } from "@/lib/api-client/cart";
import { apiErrorMessage } from "@/lib/api-client/error-copy";
import { flyToCart } from "@/lib/fly-to-cart";
import type { ApiFailure } from "@/lib/api-client/http";
import { productHref, ROUTES } from "@/lib/routes";
import { MAX_LINE_QUANTITY } from "@/modules/cart/schema";

function firstItemReason(failure: ApiFailure): string | null {
  const items = failure.details?.items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const first: unknown = items[0];
  if (typeof first !== "object" || first === null) return null;
  const reason = (first as Record<string, unknown>).reason;
  return typeof reason === "string" ? reason : null;
}

/** Thai text for a refused add. Falls back to the shared mapping of the error code. */
export function addToCartMessage(failure: ApiFailure): string {
  if (failure.code === "PRODUCT_UNAVAILABLE") {
    const reason = firstItemReason(failure);
    if (reason === "OWN_STORE") return th.cart.add.ownStore;
    if (reason === "NOT_AVAILABLE") return th.cart.add.notAvailable;
  }
  if (failure.code === "INSUFFICIENT_STOCK") return th.errors.insufficientStock;
  // 400 on an add: the stored line plus this quantity is above 99 (API_CONTRACTS 5.4).
  if (failure.code === "VALIDATION_ERROR") return th.cart.add.tooMany;
  if (failure.code === "NOT_FOUND") return th.cart.add.notAvailable;
  return apiErrorMessage(failure);
}

export interface AddToCartProps {
  productId: string;
  slug: string;
  /** Stock as the server sent it; it only limits the stepper. The server checks stock again. */
  stock: number;
  soldOut: boolean;
}

/**
 * Quantity and "add to cart" for the product page. It sends a product id and a quantity and
 * nothing else; the server decides price, stock, and ownership. A session that has ended
 * (`401`) shows a sign-in link that comes back to this product.
 */
export function AddToCart({ productId, slug, stock, soldOut }: AddToCartProps) {
  const router = useRouter();
  const [quantity, setQuantity] = useState(1);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [added, setAdded] = useState(false);
  const [lowered, setLowered] = useState(false);

  if (soldOut || stock < 1) {
    return <Alert tone="info">{th.cart.soldOutRefused}</Alert>;
  }

  const max = Math.min(stock, MAX_LINE_QUANTITY);

  async function onSubmit() {
    if (pending) return;
    setFailure(null);
    setAdded(false);
    setPending(true);
    const response = await addCartItem(productId, quantity);
    setPending(false);
    if (response.ok) {
      setAdded(true);
      flyToCart();
      // Re-reads the header so the red cart badge shows the new count.
      router.refresh();
      return;
    }
    setFailure(response);
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit();
      }}
      className="flex flex-col gap-3"
      aria-label={th.cart.add.submit}
    >
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="add-to-cart-quantity" className="type-label">
          {th.cart.add.quantity}
        </label>
        <QuantityStepper
          id="add-to-cart-quantity"
          name="quantity"
          value={quantity}
          max={max}
          onChange={(value) => {
            setQuantity(value);
            setAdded(false);
          }}
          onLowered={() => setLowered(true)}
          decreaseLabel={th.cart.decrease}
          increaseLabel={th.cart.increase}
          aria-describedby="add-to-cart-stock"
          disabled={pending}
        />
        <p id="add-to-cart-stock" className="type-small text-foreground-secondary">
          {fill(th.cart.add.stockNote, { stock })}
        </p>
      </div>
      {lowered ? (
        <Alert tone="warning">{fill(th.quantity.lowered, { available: max })}</Alert>
      ) : null}
      {failure ? (
        <RequestError
          failure={failure}
          returnTo={productHref(slug)}
          message={addToCartMessage(failure)}
        />
      ) : null}
      {added ? (
        <Alert
          tone="success"
          action={
            <Link
              href={ROUTES.cart}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              {th.cart.add.viewCart}
            </Link>
          }
        >
          {th.cart.add.success}
        </Alert>
      ) : null}
      <div>
        <Button type="submit" size="lg" loading={pending}>
          {th.cart.add.submit}
        </Button>
      </div>
    </form>
  );
}
