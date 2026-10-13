/**
 * The decoy cookie of a duplicate sign-up (CR-57, TM-03). No database is reached: creating the
 * auth instance and resolving its context only builds the configuration.
 *
 * The real session cookie line is written by better-call's `serializeSignedCookie`, which the
 * library calls from `setSessionCookie`. better-call is not a dependency of this project, so it is
 * loaded from where better-auth resolves it, and the decoy line is compared with the line it
 * writes for the same name and attributes.
 */
import { createRequire } from "node:module";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "../logger";
import { SESSION_LIFETIME_SECONDS } from "./config";
import {
  decoySessionCookieLine,
  decoySessionCookieValue,
  equaliseSignInWork,
  serializeCookieLine,
} from "./sign-up-cookie";

afterEach(() => {
  vi.unstubAllEnvs();
});

async function authWith(secureCookies: boolean) {
  vi.stubEnv("DATABASE_URL", "postgresql://shop:Zq7dbPw@db.example.test:5432/shop");
  const { createAuth } = await import("./auth");
  const url = secureCookies ? "https://shop.example.test" : "http://localhost:3000";
  return createAuth({
    secret: "Zq7canary-validated-secret-a8f3k2m9q1w7e5r0",
    baseUrl: url,
    appOrigin: url,
    secureCookies,
    trustedProxy: { trustedProxyHops: 0 },
    logger: createLogger({ level: "error", write: () => undefined }),
  });
}

type SerializeSignedCookie = (
  name: string,
  value: string,
  secret: string,
  options: Record<string, unknown>,
) => Promise<string>;

function libraryCookieSerializer(): SerializeSignedCookie {
  const fromProject = createRequire(import.meta.url);
  const fromLibrary = createRequire(fromProject.resolve("better-auth"));
  const loaded = fromLibrary("better-call") as { serializeSignedCookie: SerializeSignedCookie };
  return loaded.serializeSignedCookie;
}

/** `name=<value>; attributes`, with the value replaced by a marker. */
function masked(line: string): string {
  const separator = line.indexOf("=");
  const end = line.indexOf(";");
  return `${line.slice(0, separator)}=<value>${line.slice(end)}`;
}

/** The decoded value: a 32-character token, a dot, and a 44-character base64 signature. */
const VALUE_FORM = /^[A-Za-z0-9]{32}\.[A-Za-z0-9+/]{43}=$/;

describe("decoySessionCookieLine (CR-57)", () => {
  it.each([
    [
      false,
      `better-auth.session_token=<value>; Max-Age=${String(SESSION_LIFETIME_SECONDS)}; Path=/; HttpOnly; SameSite=Lax`,
    ],
    [
      true,
      `__Host-better-auth.session_token=<value>; Max-Age=${String(SESSION_LIFETIME_SECONDS)}; Path=/; HttpOnly; Secure; SameSite=Lax`,
    ],
  ])(
    "with secure cookies %s, has the session cookie's name and attributes",
    async (secure, expected) => {
      const auth = await authWith(secure);
      expect(masked(await decoySessionCookieLine(auth))).toBe(expected);
    },
  );

  it.each([false, true])(
    "with secure cookies %s, equals the line the library's serializer writes, but for the value",
    async (secure) => {
      const auth = await authWith(secure);
      const context = await auth.$context;
      const serializeSignedCookie = libraryCookieSerializer();
      const real = await serializeSignedCookie(
        context.authCookies.sessionToken.name,
        "a".repeat(32),
        context.secret,
        {
          ...context.authCookies.sessionToken.attributes,
          maxAge: context.sessionConfig.expiresIn,
        },
      );
      const decoy = await decoySessionCookieLine(auth);
      expect(masked(decoy)).toBe(masked(real));
      // The real value has the same form as the decoy's.
      const realValue = decodeURIComponent(real.slice(real.indexOf("=") + 1, real.indexOf(";")));
      expect(realValue).toMatch(VALUE_FORM);
    },
  );

  it("writes a value of the real form, new each time", () => {
    const values = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const value = decoySessionCookieValue();
      expect(decodeURIComponent(value)).toMatch(VALUE_FORM);
      values.add(value);
    }
    expect(values.size).toBe(50);
  });

  it("follows the library's rules for a __Host- or __Secure- name and for a domain", () => {
    expect(
      serializeCookieLine("__Host-x", "v", { path: "/a", domain: "example.test", maxAge: 5.7 }),
    ).toBe("__Host-x=v; Max-Age=5; Path=/; Secure");
    expect(serializeCookieLine("__Secure-x", "v", {})).toBe("__Secure-x=v; Secure");
    expect(
      serializeCookieLine("x", "v", { domain: "example.test", sameSite: "strict", httpOnly: true }),
    ).toBe("x=v; Domain=example.test; HttpOnly; SameSite=Strict");
  });
});

describe("equaliseSignInWork (SEC-035)", () => {
  it("checks a password against a fixed hash and returns nothing", async () => {
    await expect(equaliseSignInWork("any password")).resolves.toBeUndefined();
    await expect(equaliseSignInWork("")).resolves.toBeUndefined();
  });
});
