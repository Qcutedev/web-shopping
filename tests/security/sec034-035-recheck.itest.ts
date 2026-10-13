/**
 * Re-check of SEC-034 (production session cookie `__Host-` prefix, fix c7dd1cc) and SEC-035
 * (minimum response time of failed sign-in and every sign-up, fix b2dd578). Owner: security.
 * Review: docs/reviews/SEC-033-035-recheck.md. Runs with `pnpm test:integration` (test database).
 *
 * The SEC-035 cases check lower bounds only: every failure path waits at least the production
 * floor, whichever account state the email has. A comparison of two timing distributions is not
 * kept in the suite (flaky under parallel files); it was measured once (review file).
 *
 * An `it.fails` case states the secure behaviour of an open finding (SEC-038): it is reported as
 * an expected failure while the flaw exists and turns red when the code is fixed.
 */
import { describe, expect, it } from "vitest";

import { AUTH_RESPONSE_FLOOR } from "@/server/auth/config";
import { handleGetSession, handleSignIn, handleSignOut, handleSignUp } from "@/server/auth/routes";
import { db } from "@/server/db";
import { createRateLimiter } from "@/server/rate-limit";

import {
  cookieFrom,
  freshEmail,
  get,
  json,
  makeRuntime,
  PASSWORD,
  post,
} from "../integration/auth/support";

type Runtime = ReturnType<typeof makeRuntime>;

const SHOP = "https://shop.example.test";
const HOST_NAME = "__Host-better-auth.session_token";

function productionRuntime(): Runtime {
  return makeRuntime({ secureCookies: true, baseUrl: SHOP, appOrigin: SHOP });
}

async function register(runtime: Runtime, email: string): Promise<string> {
  await runtime.auth.api.signUpEmail({ body: { name: "Test", email, password: PASSWORD } });
  return (await db.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
}

function prodPost(path: string, options: { body?: unknown; cookie?: string } = {}): Request {
  return post(path, { ...options, origin: SHOP, url: `${SHOP}${path}` });
}

/** Signs in with production settings; returns the signed value of the `__Host-` cookie. */
async function productionSession(runtime: Runtime): Promise<{ value: string; userId: string }> {
  const email = freshEmail("prod");
  const userId = await register(runtime, email);
  const response = await handleSignIn(
    prodPost("/api/v1/auth/sign-in", { body: { email, password: PASSWORD } }),
    runtime,
  );
  expect(response.status).toBe(200);
  const pair = cookieFrom(response)
    .split("; ")
    .find((entry) => entry.startsWith(`${HOST_NAME}=`));
  expect(pair).toBeDefined();
  return { value: (pair ?? "").slice(HOST_NAME.length + 1), userId };
}

async function sessionUserFor(runtime: Runtime, cookie: string): Promise<unknown> {
  const response = await handleGetSession(get("/api/v1/auth/session", { cookie }), runtime);
  const data = (await json(response))["data"] as Record<string, unknown> | null;
  return data === null ? null : data["userId"];
}

interface CookieLine {
  name: string;
  attributes: Map<string, string>;
}

function parseSetCookie(line: string): CookieLine {
  const [pair = "", ...rest] = line.split(";");
  const attributes = new Map<string, string>();
  for (const part of rest) {
    const [key = "", ...value] = part.trim().split("=");
    attributes.set(key.toLowerCase(), value.join("="));
  }
  return { name: pair.slice(0, pair.indexOf("=")), attributes };
}

function expectHostOnly(lines: string[]): void {
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    const { name, attributes } = parseSetCookie(line);
    expect(name.startsWith("__Host-"), line).toBe(true);
    expect(attributes.has("secure"), line).toBe(true);
    expect(attributes.get("path"), line).toBe("/");
    expect(attributes.has("domain"), line).toBe(false);
    expect(attributes.has("httponly"), line).toBe(true);
    expect(attributes.get("samesite")?.toLowerCase(), line).toBe("lax");
  }
}

describe("SEC-034 re-check: production cookies are __Host- and nothing else is read", () => {
  it("every Set-Cookie line of a production sign-in is __Host-, Secure, HttpOnly, Lax, Path=/, no Domain", async () => {
    const runtime = productionRuntime();
    const email = freshEmail("prod-lines");
    await register(runtime, email);
    const response = await handleSignIn(
      prodPost("/api/v1/auth/sign-in", { body: { email, password: PASSWORD } }),
      runtime,
    );
    expect(response.status).toBe(200);
    const lines = response.headers.getSetCookie();
    expectHostOnly(lines);
    expect(lines.map((line) => parseSetCookie(line).name)).toEqual([HOST_NAME]);
  });

  it("every Set-Cookie line of a production sign-out has the same attributes", async () => {
    const runtime = productionRuntime();
    const { value } = await productionSession(runtime);
    const response = await handleSignOut(
      prodPost("/api/v1/auth/sign-out", { cookie: `${HOST_NAME}=${value}` }),
      runtime,
    );
    expect(response.status).toBe(200);
    expectHostOnly(response.headers.getSetCookie());
  });

  it("the valid signed token under the old, development, or a case-variant name is not a session", async () => {
    const runtime = productionRuntime();
    const { value, userId } = await productionSession(runtime);
    expect(await sessionUserFor(runtime, `${HOST_NAME}=${value}`)).toBe(userId);
    for (const name of [
      "__Secure-better-auth.session_token",
      "better-auth.session_token",
      "__host-better-auth.session_token",
      "__HOST-better-auth.session_token",
      "__Host-Better-Auth.session_token",
      "__%48ost-better-auth.session_token",
      "%5F%5FHost-better-auth.session_token",
      "__Host-better-auth%2Esession_token",
      "__Host-better-auth.session_token.0",
    ]) {
      expect(await sessionUserFor(runtime, `${name}=${value}`), name).toBeNull();
    }
  });

  it("a cookie planted under a non-__Host- name does not displace the real one", async () => {
    const runtime = productionRuntime();
    const victim = await productionSession(runtime);
    const attacker = await productionSession(runtime);
    // A sibling host can set `better-auth.session_token` (any Domain); it comes first.
    const cookie = `better-auth.session_token=${attacker.value}; __Secure-better-auth.session_token=${attacker.value}; ${HOST_NAME}=${victim.value}`;
    expect(await sessionUserFor(runtime, cookie)).toBe(victim.userId);
  });
});

/**
 * SEC-038 (new, Low): the cookie parser of better-call 1.4.0 (`dist/cookies.mjs` `parseCookies`)
 * trims each name with `String.prototype.trim`, which removes U+00A0 and other characters beyond
 * the space and tab that RFC 6265 allows around a name. A name that starts with U+00A0 does not
 * start with `__Host-`, so a browser would apply none of the prefix rules to it, yet the server
 * reads it as the `__Host-` session cookie. Whether a browser stores and sends such a name from a
 * sibling host was not verified (no browser in this review). Browsers refuse a cookie with a
 * control character (RFC 6265bis), which rules out U+000B and U+000C from a real browser; a
 * UTF-8 U+00A0 is not trimmed (plain case below); what remains is a raw 0xA0 byte.
 */
describe("SEC-038 a whitespace-padded name is read as the __Host- session cookie", () => {
  for (const [label, pad] of [
    ["U+00A0 no-break space", "\u00a0"],
    ["U+000B vertical tab", "\u000b"],
    ["U+000C form feed", "\u000c"],
  ] as const) {
    it.fails(`a name starting with ${label} is not a session`, async () => {
      const runtime = productionRuntime();
      const { value } = await productionSession(runtime);
      expect(await sessionUserFor(runtime, `theme=dark; ${pad}${HOST_NAME}=${value}`)).toBeNull();
    });
  }

  it("a U+00A0 sent as UTF-8 (bytes C2 A0, read by Node as latin1) is not trimmed, so not a session", async () => {
    // Node's HTTP parser decodes header bytes as latin1: a browser that stores the name as UTF-8
    // sends C2 A0, which arrives as U+00C2 U+00A0. U+00C2 is not whitespace, so nothing is
    // trimmed. Only a raw 0xA0 byte (not valid UTF-8) reaches the parser as a lone U+00A0.
    const runtime = productionRuntime();
    const { value } = await productionSession(runtime);
    expect(await sessionUserFor(runtime, `theme=dark; Â ${HOST_NAME}=${value}`)).toBeNull();
  });

  it.fails(
    "a padded attacker cookie sent first does not win over the victim's real cookie",
    async () => {
      const runtime = productionRuntime();
      const victim = await productionSession(runtime);
      const attacker = await productionSession(runtime);
      // A longer Path makes a browser send the attacker's cookie first (RFC 6265 section 5.4).
      const cookie = `\u00a0${HOST_NAME}=${attacker.value}; ${HOST_NAME}=${victim.value}`;
      expect(await sessionUserFor(runtime, cookie)).toBe(victim.userId);
    },
  );
});

describe("SEC-035 re-check: every failure path waits for the production floor", () => {
  // Timers may fire a fraction of a millisecond early; never more.
  const TOLERANCE_MS = 2;
  const FLOOR = AUTH_RESPONSE_FLOOR;

  function runtimeWithFloor(auth?: Runtime["auth"]): Runtime {
    const runtime = makeRuntime({ responseFloor: FLOOR });
    return auth === undefined ? runtime : { ...runtime, auth, limiter: createRateLimiter() };
  }

  async function timed(run: () => Promise<Response>): Promise<{ response: Response; ms: number }> {
    const start = performance.now();
    const response = await run();
    return { response, ms: performance.now() - start };
  }

  async function errorBody(response: Response): Promise<string> {
    const body = await json(response);
    const error = body["error"] as Record<string, unknown>;
    delete error["requestId"];
    return JSON.stringify(body);
  }

  it("the production floor is at least 250 ms, with jitter", () => {
    expect(FLOOR.minimumMs).toBeGreaterThanOrEqual(250);
    expect(FLOOR.jitterMs).toBeGreaterThan(0);
    expect(Object.isFrozen(FLOOR)).toBe(true);
  });

  it("sign-in: eight account states all answer 401 alike after at least the floor", async () => {
    const base = runtimeWithFloor();
    const known = freshEmail("t-known");
    const inactive = freshEmail("t-inactive");
    const noAccount = freshEmail("t-noaccount");
    const noPassword = freshEmail("t-nopassword");
    const other = freshEmail("t-other");
    await register(base, known);
    await db.user.update({
      where: { id: await register(base, inactive) },
      data: { isActive: false },
    });
    await db.account.deleteMany({ where: { userId: await register(base, noAccount) } });
    await db.account.updateMany({
      where: { userId: await register(base, noPassword) },
      data: { password: null },
    });
    await register(base, other);
    const otherCookie = cookieFrom(
      await handleSignIn(
        post("/api/v1/auth/sign-in", { body: { email: other, password: PASSWORD } }),
        makeRuntime({ responseFloor: { minimumMs: 0, jitterMs: 0 } }),
      ),
    );
    const cases: readonly (readonly [string, unknown, string | undefined])[] = [
      ["unknown email", { email: freshEmail("t-nobody"), password: PASSWORD }, undefined],
      ["wrong password", { email: known, password: "wrong password" }, undefined],
      [
        "wrong password, email in capitals and padded",
        { email: `  ${known.toUpperCase()} `, password: "x" },
        undefined,
      ],
      ["deactivated, right password", { email: inactive, password: PASSWORD }, undefined],
      ["deactivated, wrong password", { email: inactive, password: "wrong password" }, undefined],
      ["user without a credential account", { email: noAccount, password: PASSWORD }, undefined],
      [
        "credential account without a password",
        { email: noPassword, password: PASSWORD },
        undefined,
      ],
      [
        "wrong password with another user's valid session cookie",
        { email: known, password: "x" },
        otherCookie,
      ],
    ];
    const bodies = new Set<string>();
    for (const [label, body, cookie] of cases) {
      const { response, ms } = await timed(() =>
        handleSignIn(
          post("/api/v1/auth/sign-in", { body, ...(cookie === undefined ? {} : { cookie }) }),
          runtimeWithFloor(base.auth),
        ),
      );
      expect(response.status, label).toBe(401);
      expect(response.headers.getSetCookie(), label).toEqual([]);
      expect(ms, label).toBeGreaterThanOrEqual(FLOOR.minimumMs - TOLERANCE_MS);
      bodies.add(await errorBody(response));
    }
    expect(bodies.size).toBe(1);
  });

  it("sign-up: new, duplicate, duplicate in capitals, and padded duplicate answer alike after the floor", async () => {
    const base = runtimeWithFloor();
    const taken = freshEmail("t-taken");
    await register(base, taken);
    const answers = new Set<string>();
    for (const [label, email] of [
      ["new", freshEmail("t-new")],
      ["duplicate", taken],
      ["duplicate in capitals", taken.toUpperCase()],
      ["duplicate padded", `  ${taken}  `],
    ] as const) {
      const { response, ms } = await timed(() =>
        handleSignUp(
          post("/api/v1/auth/sign-up", { body: { name: "T", email, password: PASSWORD } }),
          runtimeWithFloor(base.auth),
        ),
      );
      expect(response.status, label).toBe(200);
      expect(ms, label).toBeGreaterThanOrEqual(FLOOR.minimumMs - TOLERANCE_MS);
      const headers = [...response.headers.entries()]
        .filter(([key]) => key !== "x-request-id")
        .map(([key, value]) => `${key}: ${value}`)
        .sort();
      answers.add(JSON.stringify({ headers, body: await json(response) }));
    }
    expect(answers.size).toBe(1);
    expect(await db.user.count({ where: { email: taken } })).toBe(1);
  });

  it("the per-email 429 is the same for a registered and an unknown email, and does not wait", async () => {
    const base = runtimeWithFloor();
    const known = freshEmail("t-limit-known");
    await register(base, known);
    const bodies = new Set<string>();
    for (const email of [known, freshEmail("t-limit-unknown")]) {
      // One address per attempt, so only the per-email rule refuses the sixth.
      const runtime: Runtime = {
        ...makeRuntime({ responseFloor: FLOOR, trustedProxy: { trustedProxyHops: 1 } }),
        auth: base.auth,
      };
      const attempt = (i: number) =>
        handleSignIn(
          post("/api/v1/auth/sign-in", {
            body: { email, password: "x" },
            headers: { "x-forwarded-for": `198.51.100.${String(i + 1)}` },
          }),
          runtime,
        );
      for (let i = 0; i < 5; i += 1) expect((await attempt(i)).status).toBe(401);
      const { response, ms } = await timed(() => attempt(5));
      expect(response.status).toBe(429);
      expect(ms).toBeLessThan(FLOOR.minimumMs);
      bodies.add(await errorBody(response));
    }
    expect(bodies.size).toBe(1);
  });
});
