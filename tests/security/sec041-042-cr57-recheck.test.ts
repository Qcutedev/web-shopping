/**
 * Security re-check of SEC-041 and SEC-042 (commit ae8e0d3, the run limit of three) and of CR-57
 * (commit 510ebe7, sign-up signs a new user in and gives a duplicate email a decoy cookie),
 * 2026-10-14. Review: docs/reviews/SEC-042-041-CR57-recheck.md. Owner: security.
 *
 * No database, no network, no server. The CR-57 cases call `handleSignUp` itself with the
 * database module mocked (two methods) and a stub of the auth library's API around the real
 * library's cookie configuration; the real session line is written by better-call's own
 * `serializeSignedCookie`, as the library's `setSessionCookie` does.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape: every code
 * point is a number given to `String.fromCodePoint` (SEC-040).
 */
import { createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { APIError } from "better-auth/api";
import { generateRandomString } from "better-auth/crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NAME_ALLOWED_TEXT, NAME_MAX_MARK_RUN, signUpBodySchema } from "@/modules/auth/schema";
import { createAddressBodySchema, profileNameSchema } from "@/modules/profile/schema";
import type { Auth } from "@/server/auth/auth";
import type { AuthRuntime } from "@/server/auth/routes";
import { decoySessionCookieLine } from "@/server/auth/sign-up-cookie";
import { createLogger } from "@/server/logger";
import { createRateLimiter } from "@/server/rate-limit";

const state = vi.hoisted(() => ({
  /** Rows of the mocked `user` table: id to lower-cased email. */
  users: new Map<string, string>(),
  /** Arguments of every `session.deleteMany` call. */
  deleted: [] as unknown[],
  /** Passwords given to `verifyPassword` of better-auth/crypto (the SEC-035 equaliser). */
  verified: [] as string[],
}));

vi.mock("@/server/db", () => ({
  db: {
    user: {
      findUnique: ({ where }: { where: { id?: string; email?: string } }) => {
        for (const [id, email] of state.users) {
          if (where.id === id || where.email === email) return Promise.resolve({ id });
        }
        return Promise.resolve(null);
      },
    },
    session: {
      deleteMany: (args: unknown) => {
        state.deleted.push(args);
        return Promise.resolve({ count: 1 });
      },
    },
  },
}));

vi.mock("better-auth/crypto", async (importOriginal) => {
  type Verify = (input: { hash: string; password: string }) => Promise<boolean>;
  const original = await importOriginal<{ verifyPassword: Verify }>();
  const verifyPassword: Verify = (input) => {
    state.verified.push(input.password);
    return original.verifyPassword(input);
  };
  return { ...original, verifyPassword };
});

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
const accepted = (name: string): boolean => signUpBodySchema.shape.name.safeParse(name).success;

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://shop:unused@db.example.test:5432/shop");
  state.users.clear();
  state.deleted.length = 0;
  state.verified.length = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------------------------
// SEC-042: runs of combining marks.

/** A combining mark or a kept invisible character, judged one code point at a time. */
function isRunCharacter(code: number): boolean {
  return /\p{M}/u.test(cp(code)) || (code >= 0x200b && code <= 0x200d);
}

function longestRun(text: string): number {
  let longest = 0;
  let current = 0;
  for (const char of text) {
    current = isRunCharacter(char.codePointAt(0) ?? 0) ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

/** Deterministic pseudo-random numbers (mulberry32), so a failure can be replayed. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("SEC-042 re-check: no run of more than three marks, whatever kind of mark", () => {
  it("the limit is three", () => {
    expect(NAME_MAX_MARK_RUN).toBe(3);
  });

  it.each([
    ["Mn, Latin acute and friends", 0x41, [0x0301, 0x0302, 0x0303, 0x0304]],
    ["Mn, Thai vowels and tone marks", 0x0e01, [0x0e34, 0x0e48, 0x0e38, 0x0e4c]],
    ["Mc, Devanagari visarga", 0x0915, [0x0903, 0x0903, 0x0903, 0x0903]],
    ["Me, enclosing circle", 0x41, [0x20dd, 0x20dd, 0x20dd, 0x20dd]],
    ["Me, keycap after a digit", 0x31, [0x20e3, 0x20e3, 0x20e3, 0x20e3]],
    ["Mn outside the BMP, musical tremolo", 0x41, [0x1d167, 0x1d167, 0x1d167, 0x1d167]],
    ["Mn, combining half marks", 0x41, [0xfe20, 0xfe21, 0xfe22, 0xfe23]],
    ["Mn, extended diacriticals", 0x41, [0x1ab0, 0x1dc0, 0x1ab1, 0x1dc1]],
    ["variation selectors and joiners", 0x41, [0xfe0f, 0x200d, 0xfe0e, 0x200c]],
    ["marks and kept invisibles mixed", 0x41, [0x0301, 0x200b, 0x0336, 0x200b]],
  ] as const)("%s: three are accepted, four refused", (_label, base, marks) => {
    const three = cp(...marks.slice(0, 3));
    const four = cp(...marks);
    expect(accepted(`Name ${cp(base)}${three} end`)).toBe(true);
    expect(accepted(`${cp(base)}${four}`)).toBe(false);
    expect(accepted(`Name ${cp(base)}${four} end`)).toBe(false);
    expect(accepted(`Name ${cp(base)}${four}`)).toBe(false);
  });

  it("the profile name and every address text field use the same rule", () => {
    const four = `Admin${cp(0x0301, 0x0302, 0x0303, 0x0304)}`;
    const three = `Admin${cp(0x0301, 0x0302, 0x0303)}`;
    expect(profileNameSchema.safeParse(three).success).toBe(true);
    expect(profileNameSchema.safeParse(four).success).toBe(false);
    for (const field of [
      "recipientName",
      "line1",
      "subdistrict",
      "district",
      "province",
    ] as const) {
      const schema = createAddressBodySchema.shape[field];
      expect(schema.safeParse(three).success, field).toBe(true);
      expect(schema.safeParse(four).success, field).toBe(false);
    }
  });

  it("a run at the start of the name counts too, and surrounding spaces are trimmed first", () => {
    expect(accepted(`${cp(0x0301, 0x0301, 0x0301, 0x0301)}Admin`)).toBe(false);
    expect(accepted(`  Admin${cp(0x0301, 0x0302, 0x0303)}  `)).toBe(true);
    expect(accepted(`  Admin${cp(0x0301, 0x0302, 0x0303, 0x0304)}  `)).toBe(false);
  });

  it("3,000 random names: accepted exactly when no run is longer than three", () => {
    const alphabet = [
      0x41, 0x0e01, 0x20, 0x0301, 0x0336, 0x0e48, 0x0e34, 0x200b, 0x200c, 0x200d, 0xfe0e, 0xfe0f,
      0x20dd, 0x0903, 0x1d167,
    ];
    const next = random(0x5ec042);
    let refused = 0;
    for (let sample = 0; sample < 3000; sample += 1) {
      const length = 1 + Math.floor(next() * 40);
      const codes = [0x41];
      for (let i = 0; i < length; i += 1) {
        codes.push(alphabet[Math.floor(next() * alphabet.length)] ?? 0x41);
      }
      codes.push(0x41);
      const name = cp(...codes);
      const expected = longestRun(name) <= NAME_MAX_MARK_RUN;
      if (!expected) refused += 1;
      expect(accepted(name), JSON.stringify(codes)).toBe(expected);
    }
    // Both outcomes occur often enough for the comparison to mean something.
    expect(refused).toBeGreaterThan(300);
    expect(refused).toBeLessThan(2700);
  });

  it("the rule stays linear: 200,000-character hostile inputs are judged in well under a second", () => {
    const hostile = [
      `A${`${cp(0x0301, 0x0302, 0x0303)}A`.repeat(50_000)}`,
      `${`A${cp(0x0301, 0x0302, 0x0303)}`.repeat(50_000)}${cp(0x0301)}`,
      `${cp(0x0301, 0x0302, 0x0303)}${" ".repeat(200_000)}`,
      `${`${cp(0x200b)}A`.repeat(100_000)}${cp(0)}`,
    ];
    for (const text of hostile) {
      const started = performance.now();
      NAME_ALLOWED_TEXT.test(text);
      signUpBodySchema.shape.name.safeParse(text);
      expect(performance.now() - started, String(text.length)).toBeLessThan(1000);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// SEC-041: the part the limit closes. The two `it.fails` cases of
// sec039-040-cr66-recheck.test.ts stay open: one kept character after a letter, and two in a row.

const KEPT = [0x200b, 0x200c, 0x200d, 0xfe0e, 0xfe0f] as const;

describe("SEC-041 re-check: four kept invisible characters in a row are refused", () => {
  it("all 625 runs of four, after a name and inside it", () => {
    for (const a of KEPT) {
      for (const b of KEPT) {
        for (const c of KEPT) {
          for (const d of KEPT) {
            const run = cp(a, b, c, d);
            expect(accepted(`Admin${run}`), run).toBe(false);
            expect(accepted(`Ad${run}min`), run).toBe(false);
          }
        }
      }
    }
  });

  it("the 95-character hidden payload after a name is refused", () => {
    const hidden = Array.from({ length: 95 }, (_, i) => KEPT[(i * 7) % 5] ?? 0x200b);
    expect(accepted(`Admin${cp(...hidden)}`)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// CR-57: handleSignUp, new and duplicate email.

const ORIGIN = "http://localhost:3000";
const SECRET = "Zq7canary-validated-secret-a8f3k2m9q1w7e5r0";
const PASSWORD = "correct horse battery";
const VALUE_FORM = /^[A-Za-z0-9]{32}\.[A-Za-z0-9+/]{43}=$/;

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

let realAuth: Promise<Auth> | undefined;

/** The real library instance, for its cookie configuration only; its API is not called. */
function libraryAuth(): Promise<Auth> {
  realAuth ??= import("@/server/auth/auth").then(({ createAuth }) =>
    createAuth({
      secret: SECRET,
      baseUrl: ORIGIN,
      appOrigin: ORIGIN,
      secureCookies: false,
      trustedProxy: { trustedProxyHops: 0 },
      logger: createLogger({ level: "error", write: () => undefined }),
    }),
  );
  return realAuth;
}

interface Library {
  auth: Auth;
  signUps: string[];
  signIns: { email: string; password: string }[];
}

interface LibraryOptions {
  /** What `signUpEmail` throws instead of answering. */
  signUpError?: unknown;
  /** What `signInEmail` throws instead of answering. */
  signInError?: unknown;
  /** The token of the session the request's cookie names, if any. */
  previousToken?: string;
}

/**
 * The library's API as the route uses it. `signUpEmail` answers a duplicate with a made-up user
 * whose id matches no row (better-auth 1.7.7 with `autoSignIn: false`); `signInEmail` writes the
 * session line with better-call's serializer and the library's own cookie name and attributes.
 */
async function library(options: LibraryOptions = {}): Promise<Library> {
  const real = await libraryAuth();
  const context = await real.$context;
  const signUps: string[] = [];
  const signIns: { email: string; password: string }[] = [];
  const api = {
    getSession: () =>
      Promise.resolve(
        options.previousToken === undefined
          ? null
          : { session: { token: options.previousToken }, user: { id: "previous-user" } },
      ),
    signUpEmail: ({ body }: { body: { email: string } }) => {
      signUps.push(body.email);
      if (options.signUpError !== undefined) return Promise.reject(options.signUpError);
      const email = body.email.toLowerCase();
      if ([...state.users.values()].includes(email)) {
        return Promise.resolve({ user: { id: `synthetic-${randomUUID()}` } });
      }
      const id = `user-${randomUUID()}`;
      state.users.set(id, email);
      return Promise.resolve({ user: { id } });
    },
    signInEmail: async ({ body }: { body: { email: string; password: string } }) => {
      signIns.push({ email: body.email, password: body.password });
      if (options.signInError !== undefined) throw options.signInError;
      const line = await libraryCookieSerializer()(
        context.authCookies.sessionToken.name,
        generateRandomString(32, "a-z", "A-Z", "0-9"),
        context.secret,
        { ...context.authCookies.sessionToken.attributes, maxAge: context.sessionConfig.expiresIn },
      );
      const headers = new Headers();
      headers.append("set-cookie", line);
      return { headers, response: { token: "new-token", user: { id: "new-user" } } };
    },
  };
  return { auth: { $context: real.$context, api } as unknown as Auth, signUps, signIns };
}

function runtime(auth: Auth): AuthRuntime {
  return {
    auth,
    appOrigin: ORIGIN,
    trustedProxy: { trustedProxyHops: 0 },
    limiter: createRateLimiter(),
    logger: createLogger({ level: "error", write: () => undefined }),
    responseFloor: { minimumMs: 0, jitterMs: 0 },
  };
}

async function signUp(
  lib: Library,
  body: Record<string, unknown>,
  cookie?: string,
): Promise<Response> {
  const { handleSignUp } = await import("@/server/auth/routes");
  return handleSignUp(
    new Request(`${ORIGIN}/api/v1/auth/sign-up`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        ...(cookie === undefined ? {} : { cookie }),
      },
      body: JSON.stringify(body),
    }),
    runtime(lib.auth),
  );
}

/** Every header but the request id, each `Set-Cookie` value replaced by a marker. */
function maskedHeaders(response: Response): string[] {
  return [...response.headers.entries()]
    .filter(([key]) => key !== "x-request-id")
    .map(([key, value]) =>
      key === "set-cookie"
        ? `${key}: ${value.slice(0, value.indexOf("="))}=<value>${value.slice(value.indexOf(";"))}`
        : `${key}: ${value}`,
    )
    .sort();
}

function cookieValue(line: string): string {
  return decodeURIComponent(line.slice(line.indexOf("=") + 1, line.indexOf(";")));
}

/** True when the value's signature is better-call's HMAC-SHA-256 of its token under `secret`. */
function signedWith(value: string, secret: string): boolean {
  const dot = value.lastIndexOf(".");
  const expected = createHmac("sha256", secret).update(value.slice(0, dot)).digest("base64");
  return value.slice(dot + 1) === expected;
}

async function registered(): Promise<string> {
  const email = `holder-${randomUUID()}@example.test`;
  state.users.set(`user-${randomUUID()}`, email);
  return email;
}

describe("CR-57 re-check: a duplicate email cannot be told from a new one by the answer", () => {
  it("same status, body, and headers; one session line each, differing only in the value", async () => {
    const email = await registered();
    const fresh = await signUp(await library(), {
      name: "T",
      email: `new-${randomUUID()}@example.test`,
      password: PASSWORD,
    });
    const duplicate = await signUp(await library(), { name: "T", email, password: PASSWORD });
    const capitals = await signUp(await library(), {
      name: "T",
      email: `  ${email.toUpperCase()}  `,
      password: PASSWORD,
    });
    expect(fresh.status).toBe(200);
    const freshBody = await fresh.text();
    for (const response of [duplicate, capitals]) {
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(freshBody);
      expect(maskedHeaders(response)).toEqual(maskedHeaders(fresh));
    }
    for (const response of [fresh, duplicate, capitals]) {
      const lines = response.headers.getSetCookie();
      expect(lines).toHaveLength(1);
      expect(cookieValue(lines[0] ?? "")).toMatch(VALUE_FORM);
    }
  });

  it("the real line is signed with the secret (the check below is the library's HMAC)", async () => {
    const response = await signUp(await library(), {
      name: "T",
      email: `new-${randomUUID()}@example.test`,
      password: PASSWORD,
    });
    expect(signedWith(cookieValue(response.headers.getSetCookie()[0] ?? ""), SECRET)).toBe(true);
  });

  it("the duplicate's value is never signed with the secret, and is new every time", async () => {
    const email = await registered();
    const fromRoute = await signUp(await library(), { name: "T", email, password: PASSWORD });
    const values = [cookieValue(fromRoute.headers.getSetCookie()[0] ?? "")];
    const real = await libraryAuth();
    for (let i = 0; i < 300; i += 1) values.push(cookieValue(await decoySessionCookieLine(real)));
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) {
      expect(value).toMatch(VALUE_FORM);
      expect(signedWith(value, SECRET)).toBe(false);
    }
  });
});

describe("CR-57 re-check: a duplicate email signs nobody in", () => {
  it("the library's sign-in is never called for a duplicate, with the right or a wrong password", async () => {
    const email = await registered();
    for (const password of [PASSWORD, "another password"]) {
      const lib = await library();
      const response = await signUp(lib, { name: "T", email, password });
      expect(response.status).toBe(200);
      expect(lib.signUps).toEqual([email]);
      expect(lib.signIns).toEqual([]);
    }
  });

  it("the duplicate does the same password work as the new path: one verify, with the password sent", async () => {
    const email = await registered();
    await signUp(await library(), { name: "T", email, password: "Zz9-equaliser-check" });
    expect(state.verified).toEqual(["Zz9-equaliser-check"]);
  });

  it("a new email is signed in once, with exactly the email and password of the sign-up", async () => {
    const lib = await library();
    const email = `new-${randomUUID()}@example.test`;
    await signUp(lib, { name: "T", email, password: PASSWORD });
    expect(lib.signIns).toEqual([{ email, password: PASSWORD }]);
    expect(state.verified).toEqual([]);
  });

  it("two sign-ups at once (unique index): the decoy when the account exists, no sign-in", async () => {
    const email = await registered();
    const lib = await library({
      signUpError: new APIError("UNPROCESSABLE_ENTITY", { code: "FAILED_TO_CREATE_USER" }),
    });
    const response = await signUp(lib, { name: "T", email, password: PASSWORD });
    expect(response.status).toBe(200);
    expect(lib.signIns).toEqual([]);
    expect(response.headers.getSetCookie()).toHaveLength(1);
    expect(signedWith(cookieValue(response.headers.getSetCookie()[0] ?? ""), SECRET)).toBe(false);
  });

  it("fails closed: no account after the unique-index error, another library error, or a failed sign-in is a 500 with no cookie", async () => {
    const cases: [string, LibraryOptions][] = [
      [
        "unique-index error but no account",
        { signUpError: new APIError("UNPROCESSABLE_ENTITY", { code: "FAILED_TO_CREATE_USER" }) },
      ],
      ["another library error", { signUpError: new APIError("BAD_REQUEST", { code: "OTHER" }) }],
      ["sign-in after creation fails", { signInError: new APIError("UNAUTHORIZED") }],
    ];
    for (const [label, options] of cases) {
      const response = await signUp(await library(options), {
        name: "T",
        email: `new-${randomUUID()}@example.test`,
        password: PASSWORD,
      });
      expect(response.status, label).toBe(500);
      expect(response.headers.getSetCookie(), label).toEqual([]);
    }
  });

  it("a name the schema refuses (four marks) reaches neither the library nor the database", async () => {
    const lib = await library();
    const response = await signUp(lib, {
      name: `Admin${cp(0x0301, 0x0302, 0x0303, 0x0304)}`,
      email: `new-${randomUUID()}@example.test`,
      password: PASSWORD,
    });
    expect(response.status).toBe(400);
    expect(lib.signUps).toEqual([]);
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});

describe("CR-57 re-check: the session the request came with", () => {
  const cookie = "better-auth.session_token=held.value";

  it("is deleted by its own token for a new and a duplicate email alike, and nothing else is deleted", async () => {
    const email = await registered();
    for (const target of [`new-${randomUUID()}@example.test`, email]) {
      state.deleted.length = 0;
      const lib = await library({ previousToken: "held-token" });
      const response = await signUp(lib, { name: "T", email: target, password: PASSWORD }, cookie);
      expect(response.status).toBe(200);
      expect(state.deleted).toEqual([{ where: { token: "held-token" } }]);
    }
  });

  it("without a session nothing is deleted", async () => {
    const email = await registered();
    for (const target of [`new-${randomUUID()}@example.test`, email]) {
      state.deleted.length = 0;
      await signUp(await library(), { name: "T", email: target, password: PASSWORD });
      expect(state.deleted).toEqual([]);
    }
  });
});
