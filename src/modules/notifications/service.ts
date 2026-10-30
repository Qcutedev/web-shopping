/**
 * Counts for the red notification badges of the navigation (display only). Each count is derived
 * from the actor's role and, for a seller, from the store id of the session; nothing here takes an
 * id from a request. A role that has no such work gets 0 without a query.
 */
import type { Actor } from "@/server/auth/actor";
import {
  countPendingApplications,
  countPendingProducts,
  countShippedForCustomer,
  countToShipForStore,
} from "./repository";

export interface NavCounts {
  /** Orders of the signed-in user that are on their way. */
  ordersOnTheWay: number;
  /** Seller only: paid orders that wait to be shipped. */
  sellerToShip: number;
  /** Admin only: seller applications waiting for a decision. */
  pendingApplications: number;
  /** Admin only: products waiting for moderation. */
  pendingProducts: number;
}

export async function getNavCounts(actor: Actor): Promise<NavCounts> {
  const isAdmin = actor.role === "ADMIN";
  const storeId = actor.role === "SELLER" ? actor.storeId : null;
  const [ordersOnTheWay, sellerToShip, pendingApplications, pendingProducts] = await Promise.all([
    countShippedForCustomer(actor.userId),
    storeId === null ? 0 : countToShipForStore(storeId),
    isAdmin ? countPendingApplications() : 0,
    isAdmin ? countPendingProducts() : 0,
  ]);
  return { ordersOnTheWay, sellerToShip, pendingApplications, pendingProducts };
}

/** Count for one admin nav badge. Admin only: any other role gets 0 without a query. */
export async function countAdminPending(
  actor: Actor,
  kind: "applications" | "products",
): Promise<number> {
  if (actor.role !== "ADMIN") return 0;
  return kind === "applications" ? countPendingApplications() : countPendingProducts();
}
