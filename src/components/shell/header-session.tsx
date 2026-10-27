import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { countCartLines } from "@/modules/cart";
import { getProfile } from "@/modules/profile";
import type { Actor } from "@/server/auth/actor";
import { getActor } from "@/server/auth/session";
import { logger } from "@/server/logger";
import { AccountMenu } from "./account-menu";
import { CartLink } from "./cart-link";
import { SignedOutNav } from "./signed-out-nav";

/**
 * Server Component: the session-dependent part of the header nav. It reads the session cookie, so
 * the layout renders it behind a Suspense boundary (Cache Components) and the rest of the header
 * stays in the static shell.
 *
 * Signed out: sign-up and sign-in links, and the cart link without a count. Signed in: the account
 * menu and the cart link with the number of cart lines, both read through the module services
 * with the session's actor. A failed read of the name or the cart degrades to the fallback name
 * or no badge; it never blocks the page. Display only: the cart, checkout, and every page check
 * the session again.
 */
export async function HeaderSession() {
  let actor: Actor | null;
  try {
    actor = await getActor(await headers());
  } catch (error) {
    unstable_rethrow(error);
    logger.warn("header.session.read_failed", { errorClass: errorClass(error) });
    actor = null;
  }
  if (actor === null) return <SignedOutNav />;

  const [name, count] = await Promise.all([readName(actor), readCartCount(actor)]);
  return (
    <>
      <AccountMenu name={name} />
      <CartLink count={count} />
    </>
  );
}

/** Error name only: never the message, which can carry user data or SQL. */
function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

async function readName(actor: Actor): Promise<string | null> {
  try {
    const profile = await getProfile(actor);
    return profile.name.trim() === "" ? null : profile.name;
  } catch (error) {
    unstable_rethrow(error);
    logger.warn("header.profile.read_failed", { errorClass: errorClass(error) });
    return null;
  }
}

/**
 * Number of cart lines (the "รายการ" of the label), not the sum of quantities. One COUNT through
 * `countCartLines`, not the priced cart: the header renders on every route group (CR-S116-02).
 */
async function readCartCount(actor: Actor): Promise<number> {
  try {
    return await countCartLines(actor);
  } catch (error) {
    unstable_rethrow(error);
    logger.warn("header.cart.read_failed", { errorClass: errorClass(error) });
    return 0;
  }
}
