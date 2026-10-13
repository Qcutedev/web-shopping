/**
 * From a request to an `Actor` (D-022): the guards every route handler and page uses.
 *
 *   getActor(source)       the actor of a valid session whose user is active, or null
 *   requireActor(source)   the same, or 401 UNAUTHENTICATED
 *
 * `source` is the request, or its headers (a page passes `await headers()`). Only the session
 * cookie is read from it. The user id comes from the session row, and the role, the active flag,
 * the store id, and the store status are read from the database for that user, in this request.
 * Nothing of the request (body, query, path, any other header or cookie) can change them: a
 * `storeId` or `role` sent by a client is never looked at here (CLAUDE.md rules 2 and 6).
 *
 * A request without a session cookie costs no database query (SR-05 item 5, "Rate limit").
 *
 * A deactivated user (REQ-A-02) is answered exactly like a caller without a session: their
 * sessions are deleted at deactivation (`deleteSessionsOfUser`, in the same transaction), and the
 * active flag is checked again here in case a session survived. A suspended store does not end a
 * session (D-027): the seller keeps the session and `requireApprovedSeller` refuses.
 */
import { unauthenticated } from "../errors";
import { db, type DbTransaction } from "../db";
import type { Actor } from "./actor";
import { type Auth, getAuth } from "./auth";
import { hasSessionCookie, headersForAuthLibrary } from "./cookies";
import { reduceLibraryError } from "./library-error";

export interface SessionRecord {
  /** The session token. Secret: never log it, never send it in a body. */
  token: string;
  userId: string;
}

function headersFrom(source: Request | Headers): Headers {
  return source instanceof Headers ? source : source.headers;
}

/**
 * The valid, unexpired session the request's cookie names, or null. The library checks the
 * cookie's signature and the session's expiry; it reads the database, and writes nothing
 * (no refresh, no deletion on read: auth.ts).
 */
export async function readSession(
  source: Request | Headers,
  auth: Auth = getAuth(),
): Promise<SessionRecord | null> {
  const headers = headersFrom(source);
  if (!hasSessionCookie(headers.get("cookie"))) return null;
  let result: Awaited<ReturnType<Auth["api"]["getSession"]>>;
  try {
    result = await auth.api.getSession({
      headers: headersForAuthLibrary(headers),
      query: { disableCookieCache: true, disableRefresh: true },
    });
  } catch (error) {
    // The guards are called by every route handler, whose `errorResponse` would log a library
    // error with its message: only its class name goes on (SEC-048, library-error.ts).
    throw reduceLibraryError(error);
  }
  if (result === null) return null;
  return { token: result.session.token, userId: result.user.id };
}

/** The actor of `userId` as the database holds it now, or null when the user is not active. */
export async function loadActor(userId: string): Promise<Actor | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { isActive: true, role: true, store: { select: { id: true, status: true } } },
  });
  if (user === null || !user.isActive) return null;
  return Object.freeze({
    userId,
    role: user.role,
    storeId: user.store?.id ?? null,
    storeStatus: user.store?.status ?? null,
  });
}

export async function getActor(
  source: Request | Headers,
  auth: Auth = getAuth(),
): Promise<Actor | null> {
  const session = await readSession(source, auth);
  if (session === null) return null;
  return loadActor(session.userId);
}

/** 401 UNAUTHENTICATED unless the request carries a valid session of an active user. */
export async function requireActor(
  source: Request | Headers,
  auth: Auth = getAuth(),
): Promise<Actor> {
  const actor = await getActor(source, auth);
  if (actor === null) throw unauthenticated();
  return actor;
}

/**
 * Deletes every session of `userId` (REQ-A-02, D-027, SR-07 item 4: the rows go, with the address
 * and browser details in them). For the service that deactivates a user, which calls it inside
 * its own transaction so that the deactivation and the deletion commit together. Returns the
 * number of sessions deleted.
 */
export async function deleteSessionsOfUser(
  userId: string,
  client: Pick<DbTransaction, "session"> = db,
): Promise<number> {
  const { count } = await client.session.deleteMany({ where: { userId } });
  return count;
}
