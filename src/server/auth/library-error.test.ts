/**
 * SEC-048: an error that reaches the auth code unexpected is logged by its class name only, never
 * with its message or stack, on every path of routes.ts and session.ts that can see one. No
 * database is reached: the auth instance is a stub whose library calls throw.
 */
import { BetterAuthError } from "better-auth";
import { APIError } from "better-auth/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isAppError, unauthenticated } from "../errors";
import { errorResponse } from "../http";
import { createLogger } from "../logger";
import type { RateLimiter } from "../rate-limit";
import type { Auth } from "./auth";
import { sessionCookieName } from "./cookies";
import { describeLibraryError, reduceLibraryError, UNKNOWN_ERROR_CLASS } from "./library-error";

const CANARY = "Zq7SECRETcanary";
const APP_ORIGIN = "https://shop.example.test";
const PASSWORD = "correct horse battery staple";

function canaryError(): BetterAuthError {
  return new BetterAuthError(
    `Invalid BETTER_AUTH_SECRETS entry: "${CANARY}-rotated". Expected format: "<version>:<secret>"`,
  );
}

function capture() {
  const lines: string[] = [];
  const logger = createLogger({ level: "debug", write: (line) => lines.push(line) });
  return { lines, logger, text: () => lines.join("\n") };
}

describe("describeLibraryError keeps labels only", () => {
  it("a BetterAuthError is recorded by its class name, without message or stack", () => {
    const record = describeLibraryError(canaryError());
    expect(record).toEqual({ errorClass: "BetterAuthError" });
    expect(JSON.stringify(record)).not.toContain(CANARY);
    expect(Object.isFrozen(record)).toBe(true);
  });

  it("an APIError keeps its class name, status, and code, and not its message", () => {
    const error = new APIError("BAD_REQUEST", { code: "FAILED_TO_CREATE_USER", message: CANARY });
    expect(describeLibraryError(error)).toEqual({
      errorClass: "APIError",
      status: 400,
      code: "FAILED_TO_CREATE_USER",
    });
  });

  it("an APIError code that is not of the form of a code is left out", () => {
    const error = new APIError("BAD_REQUEST", { code: `${CANARY} quoted value` });
    expect(describeLibraryError(error)).toEqual({ errorClass: "APIError", status: 400 });
  });

  it("other thrown values give their class name or their type", () => {
    expect(describeLibraryError(new TypeError(CANARY))).toEqual({ errorClass: "TypeError" });
    expect(describeLibraryError(CANARY)).toEqual({ errorClass: "string" });
    expect(describeLibraryError(42)).toEqual({ errorClass: "number" });
    expect(describeLibraryError(undefined)).toEqual({ errorClass: "undefined" });
    expect(describeLibraryError(null)).toEqual({ errorClass: "null" });
    expect(describeLibraryError({ message: CANARY })).toEqual({ errorClass: "Object" });
    expect(describeLibraryError(Object.create(null))).toEqual({ errorClass: UNKNOWN_ERROR_CLASS });
  });

  it("a name that is not an identifier is not copied", () => {
    const error = new Error(CANARY);
    error.name = `Error: ${CANARY}`;
    expect(describeLibraryError(error)).toEqual({ errorClass: "Error" });
    const plain = { name: `${CANARY}\nline` };
    expect(describeLibraryError(plain)).toEqual({ errorClass: "Object" });
    class Weird extends Error {}
    Object.defineProperty(Weird, "name", { value: `${CANARY} spaced` });
    expect(describeLibraryError(new Weird(CANARY))).toEqual({ errorClass: "Error" });
  });

  it("never throws, even for a value whose prototype cannot be read", () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error(CANARY);
        },
      },
    );
    expect(describeLibraryError(hostile)).toEqual({ errorClass: UNKNOWN_ERROR_CLASS });
  });
});

describe("reduceLibraryError", () => {
  it("passes an application error through unchanged", () => {
    const error = unauthenticated();
    expect(reduceLibraryError(error)).toBe(error);
  });

  it("turns anything else into INTERNAL_ERROR whose cause is the label record", () => {
    const reduced = reduceLibraryError(canaryError());
    expect(isAppError(reduced)).toBe(true);
    expect(reduced.code).toBe("INTERNAL_ERROR");
    expect(reduced.cause).toEqual({ errorClass: "BetterAuthError" });
  });

  // The control: without the reduction, the same error reaches the log with its message. This is
  // the case of tests/security/sec043-045-recheck.test.ts (SEC-048); it shows that the next case
  // fails when the fix is removed.
  it("control: errorResponse given the raw error logs the quoted value", () => {
    const { logger, text } = capture();
    errorResponse(canaryError(), { requestId: "r-1", logger });
    expect(text()).toContain(CANARY);
  });

  it("errorResponse given the reduced error logs the class name and the request id only", async () => {
    const { lines, logger, text } = capture();
    const response = errorResponse(reduceLibraryError(canaryError()), {
      requestId: "r-1",
      logger: logger.child({ requestId: "r-1" }),
    });
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toContain(CANARY);
    expect(body).toContain("r-1");
    expect(lines).toHaveLength(1);
    expect(text()).toContain("BetterAuthError");
    expect(text()).toContain("r-1");
    expect(text()).not.toContain(CANARY);
    expect(text()).not.toContain("BETTER_AUTH_SECRETS");
    expect(text()).not.toMatch(/\bat \S+:\d+:\d+/); // no stack frame
  });
});

describe("every path of routes.ts and session.ts that can see a library error reduces it", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgresql://shop:Zq7dbPw@db.example.test:5432/shop");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const throwing = () => {
    throw canaryError();
  };
  const fakeAuth = {
    api: { getSession: throwing, signUpEmail: throwing, signInEmail: throwing, signOut: throwing },
  } as unknown as Auth;
  const allowAll: RateLimiter = {
    consume: () =>
      Promise.resolve({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt: Date.now() + 60_000,
        retryAfterSeconds: 60,
        saturated: false,
      }),
  };

  async function runtimeWith(lines: string[]) {
    const routes = await import("./routes");
    const runtime: import("./routes").AuthRuntime = {
      auth: fakeAuth,
      appOrigin: APP_ORIGIN,
      trustedProxy: { trustedProxyHops: 0 },
      limiter: allowAll,
      logger: createLogger({ level: "debug", write: (line) => lines.push(line) }),
      responseFloor: { minimumMs: 0, jitterMs: 0 },
    };
    return { routes, runtime };
  }

  function post(path: string, body: unknown, cookie?: string): Request {
    const headers = new Headers({ origin: APP_ORIGIN, "content-type": "application/json" });
    if (cookie !== undefined) headers.set("cookie", cookie);
    return new Request(`${APP_ORIGIN}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  const cookie = `${sessionCookieName(false)}=sometoken.signature`;

  async function expectReduced(response: Response, lines: string[]) {
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain(CANARY);
    const text = lines.join("\n");
    expect(text).toContain("BetterAuthError");
    expect(text).toContain(body.error.requestId);
    expect(text).not.toContain(CANARY);
  }

  it("sign-up: an error of signUpEmail", async () => {
    const lines: string[] = [];
    const { routes, runtime } = await runtimeWith(lines);
    const response = await routes.handleSignUp(
      post("/api/v1/auth/sign-up", { name: "T", email: "a@example.test", password: PASSWORD }),
      runtime,
    );
    await expectReduced(response, lines);
  });

  it("sign-in: an error of getSession for the previous session", async () => {
    const lines: string[] = [];
    const { routes, runtime } = await runtimeWith(lines);
    const response = await routes.handleSignIn(
      post("/api/v1/auth/sign-in", { email: "a@example.test", password: PASSWORD }, cookie),
      runtime,
    );
    await expectReduced(response, lines);
  });

  it("sign-in: an error of signInEmail other than a 401", async () => {
    const lines: string[] = [];
    const { routes, runtime } = await runtimeWith(lines);
    const response = await routes.handleSignIn(
      post("/api/v1/auth/sign-in", { email: "a@example.test", password: PASSWORD }),
      runtime,
    );
    await expectReduced(response, lines);
  });

  it("sign-out: an error of getSession", async () => {
    const lines: string[] = [];
    const { routes, runtime } = await runtimeWith(lines);
    const response = await routes.handleSignOut(post("/api/v1/auth/sign-out", {}, cookie), runtime);
    await expectReduced(response, lines);
  });

  it("session: an error of getSession", async () => {
    const lines: string[] = [];
    const { routes, runtime } = await runtimeWith(lines);
    const response = await routes.handleGetSession(
      new Request(`${APP_ORIGIN}/api/v1/auth/session`, { headers: { cookie } }),
      runtime,
    );
    await expectReduced(response, lines);
  });

  it("the guards: requireActor throws the reduced error, so any route's errorResponse logs no message", async () => {
    const { requireActor } = await import("./session");
    let thrown: unknown;
    try {
      await requireActor(new Headers({ cookie }), fakeAuth);
    } catch (error) {
      thrown = error;
    }
    expect(isAppError(thrown)).toBe(true);
    expect((thrown as { cause?: unknown }).cause).toEqual({ errorClass: "BetterAuthError" });
    const { logger, text } = capture();
    errorResponse(thrown, { requestId: "r-2", logger });
    expect(text()).toContain("BetterAuthError");
    expect(text()).not.toContain(CANARY);
  });
});
