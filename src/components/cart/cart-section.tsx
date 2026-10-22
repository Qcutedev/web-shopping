import { redirect, unstable_rethrow } from "next/navigation";
import { requireAccountActor } from "@/components/account/account-actor";
import { AccountLoadError } from "@/components/account/load-state";
import { ROUTES, signInHref } from "@/lib/routes";
import { type CartDto, getCart } from "@/modules/cart";
import type { Actor } from "@/server/auth/actor";
import { isAppError } from "@/server/errors";
import { CartView } from "./cart-view";

/**
 * Server Component: the signed-in user's cart through the module service. The cart is runtime
 * data, so this renders behind a Suspense boundary (Cache Components).
 */
export async function CartSection() {
  let actor: Actor;
  try {
    actor = await requireAccountActor(ROUTES.cart);
  } catch (error) {
    unstable_rethrow(error);
    return <AccountLoadError retryHref={ROUTES.cart} />;
  }

  let cart: CartDto;
  try {
    cart = await getCart(actor);
  } catch (error) {
    unstable_rethrow(error);
    if (isAppError(error) && error.code === "UNAUTHENTICATED") redirect(signInHref(ROUTES.cart));
    return <AccountLoadError retryHref={ROUTES.cart} />;
  }
  return <CartView cart={cart} />;
}
