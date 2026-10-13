/**
 * CR-57 (owner, D-036 item 3): a successful sign-up signs the new user in. An email that already
 * has an account must still get an answer that cannot be told apart from a new one (TM-03,
 * SEC-035), so it gets a decoy: a `Set-Cookie` line with the session cookie's name, the same
 * attributes, and a value of the same form (32 characters of `a-z`, `A-Z`, `0-9`, a dot, and 44
 * characters of base64, URL-encoded), which is no session. No session row is created and no key
 * signs it: the signature part is random bytes, so the library refuses it like any forged cookie
 * and the visitor reads as signed out (`GET /api/v1/auth/session` gives `null`). The holder of
 * the existing account signs in normally.
 *
 * This is not a session token and is never accepted as one; real tokens are created, signed, and
 * checked only by the library (auth.ts). The line is built here because the library writes a
 * cookie only for a session it has created. Its format follows better-call 1.4.0
 * `dist/cookies.mjs` `_serialize`, which the library uses for the real line; the integration test
 * "a new and a duplicate sign-up set the same cookie line but for the value" compares the two
 * lines, and the unit test of this file pins the format for both cookie settings.
 */
import { randomBytes } from "node:crypto";

import { generateRandomString, hashPassword, verifyPassword } from "better-auth/crypto";

import type { Auth } from "./auth";

/** Length of a library session token (better-auth 1.7.7 `generateId(32)`). */
const TOKEN_LENGTH = 32;
/** Bytes of an HMAC-SHA-256 signature, as the library appends it (base64, 44 characters). */
const SIGNATURE_BYTES = 32;

/** The cookie attributes this module writes; the subset of better-call's `CookieOptions`. */
export interface DecoyCookieAttributes {
  maxAge?: number | undefined;
  domain?: string | undefined;
  path?: string | undefined;
  httpOnly?: boolean | undefined;
  secure?: boolean | undefined;
  sameSite?: string | undefined;
  partitioned?: boolean | undefined;
}

/**
 * One `Set-Cookie` line in the order and spelling of better-call 1.4.0 `_serialize`, including
 * its rules for a `__Host-` or `__Secure-` name. `value` is written as given (already encoded).
 */
export function serializeCookieLine(
  name: string,
  value: string,
  attributes: DecoyCookieAttributes,
): string {
  const options = { ...attributes };
  if (name.startsWith("__Secure-")) options.secure = true;
  if (name.startsWith("__Host-")) {
    options.secure = true;
    options.path = "/";
    options.domain = undefined;
  }
  let line = `${name}=${value}`;
  if (typeof options.maxAge === "number" && options.maxAge >= 0) {
    line += `; Max-Age=${String(Math.floor(options.maxAge))}`;
  }
  if (options.domain) line += `; Domain=${options.domain}`;
  if (options.path) line += `; Path=${options.path}`;
  if (options.httpOnly) line += "; HttpOnly";
  if (options.secure) line += "; Secure";
  if (options.sameSite) {
    line += `; SameSite=${options.sameSite.charAt(0).toUpperCase()}${options.sameSite.slice(1)}`;
  }
  if (options.partitioned) line += "; Partitioned";
  return line;
}

/** A value of the session cookie's form that is no session (see the file comment). */
export function decoySessionCookieValue(): string {
  const token = generateRandomString(TOKEN_LENGTH, "a-z", "A-Z", "0-9");
  const signature = randomBytes(SIGNATURE_BYTES).toString("base64");
  return encodeURIComponent(`${token}.${signature}`);
}

/**
 * The decoy `Set-Cookie` line for `auth`: the session cookie's name and attributes as the
 * library's own context holds them, `Max-Age` the session lifetime (as the library's
 * `setSessionCookie` writes it for a remembered sign-in), and a decoy value.
 */
export async function decoySessionCookieLine(auth: Auth): Promise<string> {
  const context = await auth.$context;
  const { name, attributes } = context.authCookies.sessionToken;
  return serializeCookieLine(name, decoySessionCookieValue(), {
    ...(attributes as DecoyCookieAttributes),
    maxAge: context.sessionConfig.expiresIn,
  });
}

/**
 * The new-email path checks the password once more than the duplicate path (the sign-in after
 * the sign-up). The duplicate path does the same amount of work against a hash of a fixed text,
 * so the two take alike time even when the work runs past the response floor (SEC-035). The
 * outcome is ignored. The hash is made once per module copy, on first use.
 */
let equaliserHash: Promise<string> | undefined;

export async function equaliseSignInWork(password: string): Promise<void> {
  equaliserHash ??= hashPassword("sign-up timing equaliser, not a credential");
  await verifyPassword({ hash: await equaliserHash, password });
}
