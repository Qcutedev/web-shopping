/**
 * Typed calls to `/api/v1/auth` (docs/API_CONTRACTS.md section 5.1). Request bodies are typed by
 * `src/modules/auth/schema.ts`. The session cookie is set by the server; nothing here stores a
 * token or decides a role.
 */
import type { SignInBody, SignUpBody } from "@/modules/auth/schema";
import { type ApiResult, apiRequest } from "./http";

export type Fetcher = typeof fetch;

export interface SessionActorDto {
  userId: string;
  role: string;
}

export function signIn(
  body: SignInBody,
  fetchImpl?: Fetcher,
): Promise<ApiResult<{ userId: string; role: string }>> {
  return apiRequest("/api/v1/auth/sign-in", { method: "POST", body, fetchImpl });
}

/**
 * The answer is `{ accepted: true }` for a new email and for one that already has an account, so
 * call `readSession` next to learn whether the person is signed in (API_CONTRACTS 5.1).
 */
export function signUp(
  body: SignUpBody,
  fetchImpl?: Fetcher,
): Promise<ApiResult<{ accepted: boolean }>> {
  return apiRequest("/api/v1/auth/sign-up", { method: "POST", body, fetchImpl });
}

/** `data` is `null` when nobody is signed in. */
export function readSession(fetchImpl?: Fetcher): Promise<ApiResult<SessionActorDto | null>> {
  return apiRequest("/api/v1/auth/session", { method: "GET", fetchImpl });
}

/** Ends the session on the server and clears the cookie. `401` means there was no session. */
export function signOut(fetchImpl?: Fetcher): Promise<ApiResult<{ signedOut: boolean }>> {
  return apiRequest("/api/v1/auth/sign-out", { method: "POST", fetchImpl });
}
