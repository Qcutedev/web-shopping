import { redirect, unstable_rethrow } from "next/navigation";
import { requireAccountActor } from "@/components/account/account-actor";
import { AccountLoadError } from "@/components/account/load-state";
import { ROUTES, signInHref } from "@/lib/routes";
import { type CartDto, getCart } from "@/modules/cart";
import { type AddressDto, listAddresses, MAX_PAGE_SIZE, type Page } from "@/modules/profile";
import type { Actor } from "@/server/auth/actor";
import { isAppError } from "@/server/errors";
import { CheckoutView } from "./checkout-view";

/**
 * Server Component: the cart and the address book of the signed-in user, read through the module
 * services. Runtime data, so it renders behind a Suspense boundary (Cache Components). The
 * addresses are the first page of the largest size; checkout offers those.
 */
export async function CheckoutSection() {
  let actor: Actor;
  try {
    actor = await requireAccountActor(ROUTES.checkout);
  } catch (error) {
    unstable_rethrow(error);
    return <AccountLoadError retryHref={ROUTES.checkout} />;
  }

  let cart: CartDto;
  let addresses: Page<AddressDto>;
  try {
    cart = await getCart(actor);
    addresses = await listAddresses(actor, { page: 1, pageSize: MAX_PAGE_SIZE });
  } catch (error) {
    unstable_rethrow(error);
    if (isAppError(error) && error.code === "UNAUTHENTICATED") {
      redirect(signInHref(ROUTES.checkout));
    }
    return <AccountLoadError retryHref={ROUTES.checkout} />;
  }
  return <CheckoutView cart={cart} addresses={addresses.items} />;
}
