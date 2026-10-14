/**
 * Helpers of the checkout and orders integration tests (T-032; docs/API_CONTRACTS.md section 5.5).
 * Not a test file. The route modules are called in process with a real `Request` and a real
 * session cookie; PostgreSQL is real.
 */
import { randomUUID } from "node:crypto";

import { POST as checkoutRoute } from "@/app/api/v1/checkout/route";
import { GET as getOrderRoute } from "@/app/api/v1/orders/[id]/route";
import { GET as listOrdersRoute } from "@/app/api/v1/orders/route";
import type { OrderDto } from "@/modules/orders";

import { createAddress, createCart, createCartItem } from "../../helpers/factories";
import { APP_ORIGIN, APP_URL } from "../auth/support";
import type { ErrorBody, SignedIn } from "../cart/support";

export { signedIn, type ErrorBody, type SignedIn } from "../cart/support";

export interface Called<T> {
  status: number;
  body: T;
  headers: Headers;
}

export function newKey(): string {
  return randomUUID();
}

export async function postCheckout(
  user: SignedIn | null,
  body: unknown,
  options: { key?: string | null } = {},
): Promise<Called<{ data: OrderDto } & ErrorBody>> {
  const headers = new Headers({ origin: APP_ORIGIN, "content-type": "application/json" });
  if (user !== null) headers.set("cookie", user.cookie);
  const key = options.key === undefined ? newKey() : options.key;
  if (key !== null) headers.set("idempotency-key", key);
  const response = await checkoutRoute(
    new Request(`${APP_URL}/api/v1/checkout`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
  return {
    status: response.status,
    body: (await response.json()) as { data: OrderDto } & ErrorBody,
    headers: response.headers,
  };
}

export async function getOrder(user: SignedIn | null, id: string) {
  const headers = new Headers();
  if (user !== null) headers.set("cookie", user.cookie);
  const response = await getOrderRoute(
    new Request(`${APP_URL}/api/v1/orders/${encodeURIComponent(id)}`, { headers }),
    { params: Promise.resolve({ id }) },
  );
  return {
    status: response.status,
    body: (await response.json()) as { data: OrderDto } & ErrorBody,
  };
}

export async function listOrders(user: SignedIn | null, query = "") {
  const headers = new Headers();
  if (user !== null) headers.set("cookie", user.cookie);
  const response = await listOrdersRoute(
    new Request(`${APP_URL}/api/v1/orders${query}`, { headers }),
  );
  return {
    status: response.status,
    body: (await response.json()) as { data: OrderDto[]; meta: Record<string, number> } & ErrorBody,
  };
}

/** Gives the user an address and a cart holding `lines`; returns the address id and cart id. */
export async function readyToBuy(
  user: SignedIn,
  lines: { productId: string; quantity: number }[],
): Promise<{ addressId: string; cartId: string }> {
  const address = await createAddress({ userId: user.userId });
  const cart = await createCart({ userId: user.userId });
  for (const line of lines) {
    await createCartItem({ cartId: cart.id, productId: line.productId, quantity: line.quantity });
  }
  return { addressId: address.id, cartId: cart.id };
}
