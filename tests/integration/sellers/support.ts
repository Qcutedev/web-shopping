/**
 * Helpers of the seller integration tests (T-040). Not a test file.
 *
 * Users are registered through the auth library and signed in through the real sign-in route, so
 * every request below carries a real session cookie and `requireActor` reads the role and the
 * store from the database, as in a running server.
 */
import { expect } from "vitest";

import { POST as signInRoute } from "@/app/api/v1/auth/sign-in/route";
import type { Actor } from "@/server/auth/actor";
import { getAuth } from "@/server/auth/auth";
import { db, type Role } from "@/server/db";

import { createStore } from "../../helpers/factories";
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
  storeId: string | null;
}

/**
 * Registers a user, gives it `role`, and signs it in. A `SELLER` gets a store with `storeStatus`
 * (the state an approval leaves, written directly, for the cases that do not test the approval).
 */
export async function signedIn(
  role: Role = "CUSTOMER",
  storeStatus: "APPROVED" | "SUSPENDED" = "APPROVED",
): Promise<SignedIn> {
  const email = freshEmail(role.toLowerCase());
  await getAuth().api.signUpEmail({ body: { name: "Test", email, password: PASSWORD } });
  const user = await db.user.update({ where: { email }, data: { role }, select: { id: true } });
  const storeId =
    role === "SELLER" ? (await createStore({ ownerId: user.id, status: storeStatus })).id : null;
  resetProcessRateLimiter();
  const response = await signInRoute(
    post("/api/v1/auth/sign-in", { body: { email, password: PASSWORD } }),
  );
  expect(response.status).toBe(200);
  return { userId: user.id, cookie: cookieFrom(response), storeId };
}

export function request(
  method: "GET" | "POST" | "PATCH",
  path: string,
  options: { cookie?: string; body?: unknown; rawBody?: string } = {},
): Request {
  const headers = new Headers();
  if (options.cookie !== undefined) headers.set("cookie", options.cookie);
  if (method !== "GET") {
    headers.set("origin", APP_ORIGIN);
    headers.set("content-type", "application/json");
  }
  const body =
    options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  return new Request(`${APP_URL}${path}`, {
    method,
    headers,
    ...(body === undefined || method === "GET" ? {} : { body }),
  });
}

export async function json<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function errorCode(response: Response): Promise<string> {
  return (await json<{ error: { code: string } }>(response)).error.code;
}

export function adminActor(userId: string): Actor {
  return Object.freeze({ userId, role: "ADMIN", storeId: null, storeStatus: null });
}
