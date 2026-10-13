/**
 * T-015: register, log in, log out, session expiry, through the real route modules of
 * src/app/api/v1/auth (REQ-C-01, REQ-C-02; SECURITY.md TM-02, TM-03, TM-04, SR-07).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// `connection()` needs the framework's request scope, which no server provides here. It only
// keeps the GET handler from being prerendered; the rest of the handler runs as in a server.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => undefined),
}));

import { POST as signOutRoute } from "@/app/api/v1/auth/sign-out/route";
import { POST as signInRoute } from "@/app/api/v1/auth/sign-in/route";
import { POST as signUpRoute } from "@/app/api/v1/auth/sign-up/route";
import { GET as sessionRoute } from "@/app/api/v1/auth/session/route";
import { getActor, requireActor } from "@/server/auth/session";
import { purgeExpiredSessions } from "@/server/auth/session-purge";
import { AUTH_RESPONSE_FLOOR, SESSION_LIFETIME_SECONDS } from "@/server/auth/config";
import { handleSignIn, handleSignUp } from "@/server/auth/routes";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { createRateLimiter } from "@/server/rate-limit";

import {
  cookieAttributes,
  cookieFrom,
  freshEmail,
  get,
  json,
  makeRuntime,
  PASSWORD,
  post,
  resetProcessRateLimiter,
  stubAuthEnvironment,
} from "./support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

async function signUp(body: Record<string, unknown>): Promise<Response> {
  return signUpRoute(post("/api/v1/auth/sign-up", { body }));
}

async function signIn(
  email: string,
  password: string,
  extra: { cookie?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  return signInRoute(post("/api/v1/auth/sign-in", { body: { email, password }, ...extra }));
}

/**
 * A registered user with no session: the session that sign-up starts (CR-57) is deleted, so the
 * cases below count only the sessions they create themselves.
 */
async function registered(name = "สมชาย ใจดี"): Promise<{ email: string; userId: string }> {
  const email = freshEmail();
  const response = await signUp({ name, email, password: PASSWORD });
  expect(response.status).toBe(200);
  const user = await db.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  await db.session.deleteMany({ where: { userId: user.id } });
  return { email, userId: user.id };
}

/** A `Set-Cookie` line with its value replaced by a marker. */
function maskedCookieLines(response: Response): string[] {
  return response.headers
    .getSetCookie()
    .map((line) => `${line.slice(0, line.indexOf("="))}=<value>${line.slice(line.indexOf(";"))}`);
}

describe("sign-up (REQ-C-01)", () => {
  it("creates an active CUSTOMER with a hashed password, and signs it in (CR-57)", async () => {
    const email = freshEmail();
    const response = await signUp({ name: "สมหญิง", email, password: PASSWORD });
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ data: { accepted: true } });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(maskedCookieLines(response)).toEqual([
      `better-auth.session_token=<value>; Max-Age=${String(SESSION_LIFETIME_SECONDS)}; Path=/; HttpOnly; SameSite=Lax`,
    ]);

    const user = await db.user.findUniqueOrThrow({
      where: { email },
      include: { accounts: true, sessions: true },
    });
    expect(user).toMatchObject({ role: "CUSTOMER", isActive: true, name: "สมหญิง", phone: null });
    expect(user.sessions).toHaveLength(1);
    expect(await getActor(get("/x", { cookie: cookieFrom(response) }))).toEqual({
      userId: user.id,
      role: "CUSTOMER",
      storeId: null,
      storeStatus: null,
    });
    expect(user.accounts).toHaveLength(1);
    const account = user.accounts[0];
    expect(account?.providerId).toBe("credential");
    expect(account?.password).toBeTypeOf("string");
    expect(account?.password).not.toContain(PASSWORD);
    // The library's default hash is scrypt: `<salt hex>:<key hex>`.
    expect(account?.password).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
  });

  it("stores the email lower-cased and trimmed", async () => {
    const email = freshEmail("Mixed.Case");
    await signUp({ name: "a", email: `  ${email.toUpperCase()} `, password: PASSWORD });
    expect(await db.user.count({ where: { email: email.toLowerCase() } })).toBe(1);
  });

  it("answers a registered email exactly like a new one, creates nothing, and changes nothing", async () => {
    const { email, userId } = await registered();
    const before = await db.user.findUniqueOrThrow({
      where: { id: userId },
      include: { accounts: true },
    });

    const duplicate = await signUp({ name: "Other", email, password: "another password" });
    const fresh = await signUp({
      name: "Other",
      email: freshEmail(),
      password: "another password",
    });
    expect(duplicate.status).toBe(fresh.status);
    expect(await json(duplicate)).toEqual(await json(fresh));
    // CR-57: both set one session cookie line; only the value differs.
    expect(maskedCookieLines(duplicate)).toHaveLength(1);
    expect(maskedCookieLines(duplicate)).toEqual(maskedCookieLines(fresh));
    const headerNames = (response: Response) => [...response.headers.keys()].sort();
    expect(headerNames(duplicate)).toEqual(headerNames(fresh));
    // The duplicate's cookie is a decoy: no session, and no session row for the existing user.
    expect(await getActor(get("/x", { cookie: cookieFrom(duplicate) }))).toBeNull();
    expect(await db.session.count({ where: { userId } })).toBe(0);

    const after = await db.user.findUniqueOrThrow({
      where: { id: userId },
      include: { accounts: true },
    });
    expect(after).toEqual(before);
    expect(await db.user.count({ where: { email } })).toBe(1);
    // The old password still works; the new one does not.
    expect((await signIn(email, PASSWORD)).status).toBe(200);
    resetProcessRateLimiter();
    expect((await signIn(email, "another password")).status).toBe(401);
  });

  it("a duplicate sign-up with the account's own password does not sign in either (CR-57)", async () => {
    const { email, userId } = await registered();
    const response = await signUp({ name: "Other", email, password: PASSWORD });
    expect(response.status).toBe(200);
    expect(maskedCookieLines(response)).toHaveLength(1);
    expect(await getActor(get("/x", { cookie: cookieFrom(response) }))).toBeNull();
    expect(await db.session.count({ where: { userId } })).toBe(0);
  });

  it("a new and a duplicate sign-up set the same cookie line but for the value, in production too", async () => {
    const runtime = makeRuntime({
      secureCookies: true,
      baseUrl: "https://shop.example.test",
      appOrigin: "https://shop.example.test",
    });
    const send = (email: string) =>
      handleSignUp(
        post("/api/v1/auth/sign-up", {
          body: { name: "T", email, password: PASSWORD },
          origin: "https://shop.example.test",
          url: "https://shop.example.test/api/v1/auth/sign-up",
        }),
        { ...runtime, limiter: createRateLimiter() },
      );
    const email = freshEmail("prod-signup");
    const fresh = await send(email);
    const duplicate = await send(email);
    expect(maskedCookieLines(fresh)).toEqual([
      `__Host-better-auth.session_token=<value>; Max-Age=${String(SESSION_LIFETIME_SECONDS)}; Path=/; HttpOnly; Secure; SameSite=Lax`,
    ]);
    expect(maskedCookieLines(duplicate)).toEqual(maskedCookieLines(fresh));
    // Values of one form: 32 characters, a dot, a 44-character base64 signature.
    for (const response of [fresh, duplicate]) {
      const line = response.headers.getSetCookie()[0] ?? "";
      const value = decodeURIComponent(line.slice(line.indexOf("=") + 1, line.indexOf(";")));
      expect(value).toMatch(/^[A-Za-z0-9]{32}\.[A-Za-z0-9+/]{43}=$/);
    }
  });

  it("ends the session the request came with, for a new and a duplicate email alike (rotation)", async () => {
    for (const duplicateEmail of [false, true]) {
      const holder = await registered();
      const held = cookieFrom(await signIn(holder.email, PASSWORD));
      resetProcessRateLimiter();
      expect(await getActor(get("/x", { cookie: held }))).not.toBeNull();
      const email = duplicateEmail ? holder.email : freshEmail("rotate");
      const response = await signUpRoute(
        post("/api/v1/auth/sign-up", {
          body: { name: "T", email, password: PASSWORD },
          cookie: held,
        }),
      );
      expect(response.status).toBe(200);
      expect(await getActor(get("/x", { cookie: held }))).toBeNull();
      expect(await db.session.count({ where: { userId: holder.userId } })).toBe(0);
      resetProcessRateLimiter();
    }
  });

  it("answers 200 to both of two parallel sign-ups for one email, and keeps one user and one account (CR-59)", async () => {
    const email = freshEmail("parallel");
    const responses = await Promise.all(
      [1, 2].map((n) =>
        handleSignUp(
          post("/api/v1/auth/sign-up", { body: { name: `Racer ${n}`, email, password: PASSWORD } }),
          makeRuntime({ limiter: createRateLimiter() }),
        ),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    for (const response of responses) {
      expect(await json(response)).toEqual({ data: { accepted: true } });
    }
    expect(await db.user.count({ where: { email } })).toBe(1);
    const user = await db.user.findUniqueOrThrow({ where: { email }, include: { accounts: true } });
    expect(user.accounts).toHaveLength(1);
    expect(user).toMatchObject({ role: "CUSTOMER", isActive: true });
    expect((await signIn(email, PASSWORD)).status).toBe(200);
  });

  it("refuses a password under 8 or over 128 characters on the server, creating no user", async () => {
    for (const password of ["1234567", "x".repeat(129)]) {
      const email = freshEmail();
      const response = await signUp({ name: "a", email, password });
      expect(response.status).toBe(400);
      expect((await json(response))["error"]).toMatchObject({ code: "VALIDATION_ERROR" });
      expect(await db.user.count({ where: { email } })).toBe(0);
    }
  });
});

describe("sign-in and the session cookie (REQ-C-02)", () => {
  it("starts a session, sets an HttpOnly SameSite=Lax cookie with a bounded lifetime", async () => {
    const { email, userId } = await registered();
    const response = await signIn(email, PASSWORD, {
      headers: { "user-agent": `UA ${"x".repeat(600)}` },
    });
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ data: { userId, role: "CUSTOMER" } });

    const attributes = cookieAttributes(response, "better-auth.session_token");
    expect(attributes).toBeDefined();
    expect(attributes?.has("httponly")).toBe(true);
    expect(attributes?.get("samesite")?.toLowerCase()).toBe("lax");
    expect(attributes?.get("path")).toBe("/");
    expect(attributes?.get("max-age")).toBe(String(SESSION_LIFETIME_SECONDS));
    // Not production: no Secure attribute in development and tests (see production-cookies).
    expect(attributes?.has("secure")).toBe(false);

    const sessions = await db.session.findMany({ where: { userId } });
    expect(sessions).toHaveLength(1);
    const session = sessions[0];
    // SR-07 item 2: no trusted proxy, so the address is unknown and nothing is stored.
    expect(session?.ipAddress).toBeNull();
    // SR-07 item 3: the browser details are cut to 512 characters.
    expect(session?.userAgent).toHaveLength(512);
    const lifetime = (session?.expiresAt.getTime() ?? 0) - (session?.createdAt.getTime() ?? 0);
    expect(Math.abs(lifetime - SESSION_LIFETIME_SECONDS * 1000)).toBeLessThan(5_000);
    // The cookie carries the token, and the token is 32 random characters.
    expect(session?.token).toMatch(/^[A-Za-z0-9]{32}$/);

    const actor = await getActor(get("/x", { cookie: cookieFrom(response) }));
    expect(actor).toEqual({ userId, role: "CUSTOMER", storeId: null, storeStatus: null });
  });

  it("answers an unknown email, a wrong password, and a deactivated account identically", async () => {
    const active = await registered();
    const deactivated = await registered();
    await db.user.update({ where: { id: deactivated.userId }, data: { isActive: false } });

    const answers: unknown[] = [];
    for (const [email, password] of [
      [freshEmail("nobody"), PASSWORD],
      [active.email, "wrong password"],
      [deactivated.email, PASSWORD],
    ] as const) {
      resetProcessRateLimiter();
      const response = await signIn(email, password);
      expect(response.status).toBe(401);
      expect(response.headers.getSetCookie()).toEqual([]);
      const body = await json(response);
      const error = body["error"] as Record<string, unknown>;
      answers.push({ ...error, requestId: "<id>" });
    }
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
    expect(answers[0]).toEqual({
      code: "UNAUTHENTICATED",
      message: "The email or password is incorrect.",
      details: {},
      requestId: "<id>",
    });
    expect(await db.session.count({ where: { userId: deactivated.userId } })).toBe(0);
    expect(await db.session.count({ where: { userId: active.userId } })).toBe(0);
  });

  it("rotates on login: signing in again from a browser that holds a session replaces it", async () => {
    const { email, userId } = await registered();
    const first = await signIn(email, PASSWORD);
    const firstCookie = cookieFrom(first);
    resetProcessRateLimiter();
    const second = await signIn(email, PASSWORD, { cookie: firstCookie });
    expect(second.status).toBe(200);
    expect(cookieFrom(second)).not.toBe(firstCookie);
    expect(await db.session.count({ where: { userId } })).toBe(1);
    expect(await getActor(get("/x", { cookie: firstCookie }))).toBeNull();
    expect(await getActor(get("/x", { cookie: cookieFrom(second) }))).not.toBeNull();
  });
});

describe("GET /api/v1/auth/session", () => {
  it("returns the actor for a valid cookie, null without one, and null for a forged one", async () => {
    const { email, userId } = await registered();
    const cookie = cookieFrom(await signIn(email, PASSWORD));

    const withCookie = await sessionRoute(get("/api/v1/auth/session", { cookie }));
    expect(withCookie.status).toBe(200);
    expect(withCookie.headers.get("cache-control")).toBe("no-store");
    expect(await json(withCookie)).toEqual({
      data: { userId, role: "CUSTOMER", storeId: null, storeStatus: null },
    });

    expect(await json(await sessionRoute(get("/api/v1/auth/session")))).toEqual({ data: null });

    const token = cookie.split("=")[1]?.split(".")[0] ?? "";
    for (const forged of [
      `better-auth.session_token=${token}`,
      `better-auth.session_token=${token}.AAAA`,
      "better-auth.session_token=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.signature",
      `__Secure-better-auth.session_token=${cookie.split("=")[1] ?? ""}`,
    ]) {
      expect(
        await json(await sessionRoute(get("/api/v1/auth/session", { cookie: forged }))),
      ).toEqual({ data: null });
    }
  });
});

describe("sign-out (REQ-C-02)", () => {
  it("deletes the session on the server: the old cookie is refused afterwards", async () => {
    const { email, userId } = await registered();
    const cookie = cookieFrom(await signIn(email, PASSWORD));
    expect(await db.session.count({ where: { userId } })).toBe(1);

    const response = await signOutRoute(post("/api/v1/auth/sign-out", { cookie }));
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ data: { signedOut: true } });
    const cleared = cookieAttributes(response, "better-auth.session_token");
    expect(cleared?.get("max-age")).toBe("0");

    expect(await db.session.count({ where: { userId } })).toBe(0);
    expect(await getActor(get("/x", { cookie }))).toBeNull();
    await expect(requireActor(get("/x", { cookie }))).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      status: 401,
    });
    // Signing out with the dead cookie is 401: there is no session left to end.
    expect((await signOutRoute(post("/api/v1/auth/sign-out", { cookie }))).status).toBe(401);
  });

  it("is 401 without a session, 403 from a foreign origin, 415 without a content type", async () => {
    const { email } = await registered();
    const cookie = cookieFrom(await signIn(email, PASSWORD));
    expect((await signOutRoute(post("/api/v1/auth/sign-out"))).status).toBe(401);
    expect(
      (
        await signOutRoute(
          post("/api/v1/auth/sign-out", { cookie, origin: "https://evil.example" }),
        )
      ).status,
    ).toBe(403);
    expect(
      (await signOutRoute(post("/api/v1/auth/sign-out", { cookie, contentType: null }))).status,
    ).toBe(415);
    // None of the refused requests ended the session.
    expect(await getActor(get("/x", { cookie }))).not.toBeNull();
  });
});

describe("session expiry (SR-07 item 5)", () => {
  it("refuses an expired session, writes nothing while reading it, and the purge removes it", async () => {
    const { email, userId } = await registered();
    const expiredCookie = cookieFrom(await signIn(email, PASSWORD));
    resetProcessRateLimiter();
    const liveCookie = cookieFrom(await signIn(email, PASSWORD));
    // The second sign-in came without the first cookie, so both sessions exist.
    expect(await db.session.count({ where: { userId } })).toBe(2);
    const expiredToken = (expiredCookie.split("=")[1] ?? "").split(".")[0] ?? "";
    await db.session.update({
      where: { token: decodeURIComponent(expiredToken) },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    expect(await getActor(get("/x", { cookie: expiredCookie }))).toBeNull();
    // Reading an expired session does not delete it (a GET writes nothing, D-029 point 1).
    expect(await db.session.count({ where: { userId } })).toBe(2);

    const removed = await purgeExpiredSessions();
    expect(removed.sessions).toBe(1);
    expect(await db.session.count({ where: { userId } })).toBe(1);
    expect(await getActor(get("/x", { cookie: liveCookie }))).not.toBeNull();
  });
});

describe("guards with real sessions", () => {
  it("requireActor is 401 for an anonymous request", async () => {
    await expect(requireActor(get("/x"))).rejects.toBeInstanceOf(AppError);
    await expect(requireActor(get("/x"))).rejects.toMatchObject({ status: 401 });
  });
});

describe("response floor (SEC-035, TM-03)", () => {
  // Timers may fire a fraction of a millisecond before the measured time; never more.
  const TOLERANCE_MS = 2;

  async function timed(run: () => Promise<Response>): Promise<{ status: number; ms: number }> {
    const start = performance.now();
    const response = await run();
    return { status: response.status, ms: performance.now() - start };
  }

  it("an unknown email, a wrong password, and a deactivated account all take at least the floor", async () => {
    const floor = { minimumMs: 200, jitterMs: 0 };
    const runtime = makeRuntime({ responseFloor: floor });
    const known = freshEmail("floor-known");
    const inactive = freshEmail("floor-inactive");
    await runtime.auth.api.signUpEmail({ body: { name: "T", email: known, password: PASSWORD } });
    await runtime.auth.api.signUpEmail({
      body: { name: "T", email: inactive, password: PASSWORD },
    });
    await db.user.update({ where: { email: inactive }, data: { isActive: false } });
    for (const body of [
      { email: freshEmail("floor-nobody"), password: PASSWORD },
      { email: known, password: "wrong password" },
      { email: inactive, password: PASSWORD },
    ]) {
      const result = await timed(() =>
        handleSignIn(post("/api/v1/auth/sign-in", { body }), {
          ...runtime,
          limiter: createRateLimiter(),
        }),
      );
      expect(result.status).toBe(401);
      expect(result.ms).toBeGreaterThanOrEqual(floor.minimumMs - TOLERANCE_MS);
    }
  });

  it("a new and a duplicate sign-up both take at least the floor", async () => {
    const floor = { minimumMs: 200, jitterMs: 0 };
    const email = freshEmail("floor-signup");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await timed(() =>
        handleSignUp(
          post("/api/v1/auth/sign-up", { body: { name: "T", email, password: PASSWORD } }),
          makeRuntime({ responseFloor: floor }),
        ),
      );
      expect(result.status).toBe(200);
      expect(result.ms).toBeGreaterThanOrEqual(floor.minimumMs - TOLERANCE_MS);
    }
    expect(await db.user.count({ where: { email } })).toBe(1);
  });

  it("a refusal before the password step does not wait", async () => {
    const runtime = makeRuntime({ responseFloor: { minimumMs: 5_000, jitterMs: 0 } });
    const result = await timed(() =>
      handleSignIn(post("/api/v1/auth/sign-in", { body: { email: "x", password: "y" } }), runtime),
    );
    expect(result.status).toBe(400);
    expect(result.ms).toBeLessThan(1_000);
  });

  it("the real routes use the production floor", async () => {
    expect(AUTH_RESPONSE_FLOOR.minimumMs).toBeGreaterThanOrEqual(250);
    const result = await timed(() => signIn(freshEmail("floor-route"), PASSWORD));
    expect(result.status).toBe(401);
    expect(result.ms).toBeGreaterThanOrEqual(AUTH_RESPONSE_FLOOR.minimumMs - TOLERANCE_MS);
  });
});
