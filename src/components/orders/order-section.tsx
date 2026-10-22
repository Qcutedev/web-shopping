import { notFound, redirect, unstable_rethrow } from "next/navigation";
import { requireAccountActor } from "@/components/account/account-actor";
import { AccountLoadError } from "@/components/account/load-state";
import { orderHref, signInHref } from "@/lib/routes";
import { getOrder, type OrderDto, orderIdSchema } from "@/modules/orders";
import type { Actor } from "@/server/auth/actor";
import { isAppError } from "@/server/errors";
import { OrderDetailView } from "./order-detail-view";

/**
 * Server Component: one order of the signed-in user. Another user's order and a missing one are
 * both the not-found page (the service answers 404 for both). Runtime data, so it renders behind
 * a Suspense boundary.
 */
export async function OrderSection({ id }: { id: string }) {
  const parsed = orderIdSchema.safeParse(id);
  if (!parsed.success) notFound();
  const here = orderHref(parsed.data);

  let actor: Actor;
  try {
    actor = await requireAccountActor(here);
  } catch (error) {
    unstable_rethrow(error);
    return <AccountLoadError retryHref={here} />;
  }

  let order: OrderDto;
  try {
    order = await getOrder(actor, parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    if (isAppError(error) && error.code === "UNAUTHENTICATED") redirect(signInHref(here));
    return <AccountLoadError retryHref={here} />;
  }
  return <OrderDetailView order={order} />;
}
