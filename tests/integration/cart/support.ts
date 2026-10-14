/**
 * Helpers of the cart integration tests (T-031; docs/API_CONTRACTS.md section 5.4). Not a test
 * file. The route modules are called in process with a real `Request` and a real session cookie
 * from the sign-in route; PostgreSQL is real.
 */
import { expect } from "vitest";

import { POST as signInRoute } from "@/app/api/v1/auth/sign-in/route";
import { GET as getCartRoute } from "@/app/api/v1/cart/route";
import { POST as addItemRoute } from "@/app/api/v1/cart/items/route";
import {
  DELETE as deleteItemRoute,
  PATCH as patchItemRoute,
} from "@/app/api/v1/cart/items/[itemId]/route";
import { getAuth } from "@/server/auth/auth";
import { db, type Role } from "@/server/db";

import {
  APP_ORIGIN,
  APP_URL,
  cookieFrom,
  freshEmail,
  PASSWORD,
  post,
  resetProcessRateLimiter,
} from "../auth/support";

export interface SignedIn {
  userId: string;
  cookie: string;
}

/** Registers through the library, sets the role, and signs in through the real route. */
export async function signedIn(role: Role = "CUSTOMER"): Promise<SignedIn> {
  const email = freshEmail(role.toLowerCase());
  await getAuth().api.signUpEmail({ body: { name: "Test", email, password: PASSWORD } });
  const user = await db.user.update({ where: { email }, data: { role }, select: { id: true } });
  resetProcessRateLimiter();
  const response = await signInRoute(
    post("/api/v1/auth/sign-in", { body: { email, password: PASSWORD } }),
  );
  expect(response.status).toBe(200);
  return { userId: user.id, cookie: cookieFrom(response) };
}

export function request(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  options: { cookie?: string; body?: unknown; origin?: string | null } = {},
): Request {
  const headers = new Headers();
  if (options.cookie !== undefined) headers.set("cookie", options.cookie);
  if (method !== "GET") {
    const origin = options.origin === undefined ? APP_ORIGIN : options.origin;
    if (origin !== null) headers.set("origin", origin);
    headers.set("content-type", "application/json");
  }
  return new Request(`${APP_URL}${path}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

export interface Called<T = Record<string, unknown>> {
  status: number;
  body: T;
}

async function read<T>(response: Response): Promise<Called<T>> {
  return { status: response.status, body: (await response.json()) as T };
}

export interface LineBody {
  id: string;
  productId: string;
  quantity: number;
  requestedQuantity: number;
  quantityLowered: boolean;
  buyable: boolean;
  unbuyableReason: string | null;
  unitPriceSatang: number | null;
  lineTotalSatang: number | null;
  stock: number | null;
}

export interface CartBody {
  stores: {
    store: { name: string; slug: string };
    items: LineBody[];
    itemsSubtotalSatang: number;
    shippingFeeSatang: number;
    shippingFeeIsSimulated: boolean;
  }[];
  itemsSubtotalSatang: number;
  shippingTotalSatang: number;
  grandTotalSatang: number;
  canCheckout: boolean;
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown> & { items?: Record<string, unknown>[] };
  };
}

/** The error object without its per-request id, to compare two answers. */
export function sameAnswer(error: ErrorBody["error"]): Record<string, unknown> {
  const { requestId: _requestId, ...rest } = error as ErrorBody["error"] & { requestId?: string };
  return rest;
}

export async function getCart(user: SignedIn | null) {
  const cookie = user === null ? {} : { cookie: user.cookie };
  return read<{ data: CartBody } & ErrorBody>(
    await getCartRoute(request("GET", "/api/v1/cart", cookie)),
  );
}

export async function addItem(
  user: SignedIn | null,
  body: unknown,
  options: { origin?: string | null } = {},
) {
  const cookie = user === null ? {} : { cookie: user.cookie };
  return read<{ data: LineBody } & ErrorBody>(
    await addItemRoute(request("POST", "/api/v1/cart/items", { ...cookie, ...options, body })),
  );
}

function idParams(itemId: string) {
  return { params: Promise.resolve({ itemId }) };
}

export async function patchItem(user: SignedIn | null, itemId: string, body: unknown) {
  const cookie = user === null ? {} : { cookie: user.cookie };
  return read<{ data: LineBody } & ErrorBody>(
    await patchItemRoute(
      request("PATCH", `/api/v1/cart/items/${encodeURIComponent(itemId)}`, { ...cookie, body }),
      idParams(itemId),
    ),
  );
}

export async function deleteItem(user: SignedIn | null, itemId: string) {
  const cookie = user === null ? {} : { cookie: user.cookie };
  return read<{ data: { deleted: boolean } } & ErrorBody>(
    await deleteItemRoute(
      request("DELETE", `/api/v1/cart/items/${encodeURIComponent(itemId)}`, cookie),
      idParams(itemId),
    ),
  );
}

/** The stored lines of one user's cart, by product. */
export async function storedLines(userId: string) {
  return db.cartItem.findMany({
    where: { cart: { userId } },
    select: { id: true, productId: true, quantity: true },
    orderBy: { id: "asc" },
  });
}
