/**
 * Re-check of SEC-048 (auth part 5219fec, http part 5dfa22f). Owner: security. Review:
 * docs/reviews/SEC-046-047-recheck.md (section SEC-048).
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 * Pure: no database, no network. The Prisma error classes are constructed, not raised by a query.
 */
import { APIError } from "better-auth/api";
import { BetterAuthError } from "better-auth";
import { afterEach, describe, expect, it, vi } from "vitest";

import { reduceLibraryError } from "@/server/auth/library-error";
import { Prisma } from "@/server/db";
import { conflict, internalError } from "@/server/errors";
import { errorResponse } from "@/server/http";
import { createLogger } from "@/server/logger";

const CANARY = "Zq7SECRETcanary";
const APP_URL = "https://shop.example.test";
const DATABASE_URL = "postgresql://shop:Zq7dbPw@db.example.test:5432/shop?schema=public";
const GOOD_SECRET = "Kd2Xw9Lm4Rt6Pn3bYc5Hj8Vz7Qs1Gf0U";

interface LogLine {
  level: string;
  message: string;
  code?: string;
  status?: number;
  requestId?: string;
  err?: Record<string, unknown>;
}

function capture() {
  const lines: string[] = [];
  const logger = createLogger({ level: "debug", write: (line) => lines.push(line) });
  return { lines, logger };
}

/** Every error a route can meet: library, database client, runtime, and odd thrown values. */
function unexpectedErrors(): [string, unknown, string][] {
  const typeError = new TypeError(`Cannot read properties of ${CANARY}`, {
    cause: new Error(`nested ${CANARY}`),
  });
  const withProps = Object.assign(new Error(`query failed for ${CANARY}`), {
    detail: CANARY,
    query: `SELECT * FROM "User" WHERE email = '${CANARY}@example.test'`,
    meta: { target: [CANARY] },
  });
  return [
    ["BetterAuthError", new BetterAuthError(`Invalid entry: "${CANARY}"`), "BetterAuthError"],
    [
      "PrismaClientKnownRequestError",
      new Prisma.PrismaClientKnownRequestError(
        `Unique constraint failed on the fields: (\`email\`) value ${CANARY}`,
        { code: "P2002", clientVersion: "7.0.0", meta: { target: [CANARY], modelName: CANARY } },
      ),
      "PrismaClientKnownRequestError",
    ],
    [
      "PrismaClientInitializationError",
      new Prisma.PrismaClientInitializationError(
        `Authentication failed for postgresql://shop:${CANARY}@db.example.test`,
        "7.0.0",
      ),
      "PrismaClientInitializationError",
    ],
    [
      "PrismaClientUnknownRequestError",
      new Prisma.PrismaClientUnknownRequestError(`driver said ${CANARY}`, {
        clientVersion: "7.0.0",
      }),
      "PrismaClientUnknownRequestError",
    ],
    ["TypeError with a nested cause", typeError, "TypeError"],
    ["Error with extra properties", withProps, "Error"],
    ["thrown string", `${CANARY} as a string`, "string"],
    ["thrown plain object", { message: CANARY, detail: CANARY }, "Object"],
    [
      "Error whose name is prose",
      Object.assign(new Error("x"), { name: `Bad ${CANARY} name` }),
      "Error",
    ],
  ];
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("SEC-048 re-check: errorResponse logs labels only, for every kind of unexpected error", () => {
  it("each unexpected error gives a generic 500 and one error line whose err is { errorClass[, status][, code] } with no part of the message, stack, cause, or properties", async () => {
    for (const [label, thrown, errorClass] of unexpectedErrors()) {
      const { lines, logger } = capture();
      const response = errorResponse(thrown, { requestId: "req-sec048", logger });
      expect(response.status, label).toBe(500);
      const body = await response.text();
      expect(body, label).not.toContain(CANARY);
      expect(body, label).toContain("req-sec048");
      expect(lines, label).toHaveLength(1);
      const line = lines[0] ?? "";
      expect(line, label).not.toContain(CANARY);
      expect(line, label).not.toMatch(/\bat \S+ \(/); // no stack frame
      const parsed = JSON.parse(line) as LogLine;
      // The request id is in the line only through the caller's child logger (routes pass
      // `runtime.logger.child({ requestId })`); errorResponse puts it in the body.
      expect(parsed.level, label).toBe("error");
      expect(parsed.err?.errorClass, label).toBe(errorClass);
      for (const key of Object.keys(parsed.err ?? {})) {
        expect(["errorClass", "status", "code"], `${label}: ${key}`).toContain(key);
      }
    }
  });

  it("a Prisma error keeps its code (P2002) and nothing of meta or message", () => {
    const { lines, logger } = capture();
    const thrown = unexpectedErrors()[1]?.[1];
    errorResponse(thrown, { requestId: "r", logger });
    const parsed = JSON.parse(lines[0] ?? "") as LogLine;
    expect(parsed.err).toEqual({ errorClass: "PrismaClientKnownRequestError", code: "P2002" });
  });

  it("an APIError keeps its status and code, not its body message", () => {
    const { lines, logger } = capture();
    const thrown = new APIError("BAD_REQUEST", { message: CANARY, code: "SOME_CODE" });
    errorResponse(thrown, { requestId: "r", logger });
    expect(lines.join("\n")).not.toContain(CANARY);
    const parsed = JSON.parse(lines[0] ?? "") as LogLine;
    expect(parsed.err).toEqual({ errorClass: "APIError", status: 400, code: "SOME_CODE" });
  });

  it("an AppError made by a service: a 5xx cause and a 4xx cause are reduced the same way", () => {
    const prismaError = unexpectedErrors()[1]?.[1];
    for (const [appError, level] of [
      [internalError(new Error(`service saw ${CANARY}`)), "error"],
      [conflict("DUPLICATE_SKU", { cause: prismaError }), "warn"],
    ] as const) {
      const { lines, logger } = capture();
      errorResponse(appError, { requestId: "r", logger });
      expect(lines).toHaveLength(1);
      expect(lines[0]).not.toContain(CANARY);
      const parsed = JSON.parse(lines[0] ?? "") as LogLine;
      expect(parsed.level).toBe(level);
      for (const key of Object.keys(parsed.err ?? {})) {
        expect(["errorClass", "status", "code"]).toContain(key);
      }
    }
  });

  it("the auth record (reduceLibraryError) passes through errorResponse unchanged", () => {
    const { lines, logger } = capture();
    errorResponse(reduceLibraryError(new BetterAuthError(`quoted ${CANARY}`)), {
      requestId: "r",
      logger,
    });
    expect(lines[0]).not.toContain(CANARY);
    expect((JSON.parse(lines[0] ?? "") as LogLine).err).toEqual({ errorClass: "BetterAuthError" });
  });

  it("a hostile thrown value (property reads throw, getters throw) still gives a 500 and one line", () => {
    // Not covered here: a Proxy whose getPrototypeOf trap throws makes `instanceof` in
    // isAppError (src/server/errors.ts) throw, so errorResponse itself throws (observation in
    // the review; no realistic source of such a value is known).
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error(CANARY);
        },
        has() {
          throw new Error(CANARY);
        },
        ownKeys() {
          throw new Error(CANARY);
        },
      },
    );
    const getters = Object.defineProperties(new Error("x"), {
      name: {
        get() {
          throw new Error(CANARY);
        },
      },
      code: {
        get() {
          throw new Error(CANARY);
        },
      },
      status: {
        get() {
          throw new Error(CANARY);
        },
      },
    });
    for (const thrown of [hostile, getters]) {
      const { lines, logger } = capture();
      const response = errorResponse(thrown, { requestId: "r", logger });
      expect(response.status).toBe(500);
      expect(lines).toHaveLength(1);
      expect(lines[0]).not.toContain(CANARY);
    }
  });
});

describe("SEC-048 re-check: what an auth route throws before its try (getAuthRuntime) carries no value", () => {
  // The four route files call `getAuthRuntime()` as an argument, outside the handler's `try`, so
  // a throw there bypasses errorResponse and is printed by Next.js with message and stack. What
  // can throw there: getEnv (parseEnv) and getAuth (readAuthSecret, then createAuth, which builds
  // the library lazily and the Prisma client lazily). Both readers throw EnvValidationError,
  // whose message holds variable names and rule texts only.
  function stubEnv(overrides: Record<string, string>) {
    const base: Record<string, string> = {
      NODE_ENV: "production",
      APP_URL,
      DATABASE_URL,
      AUTH_SECRET: GOOD_SECRET,
      TRUSTED_PROXY_HOPS: "0",
      TRUSTED_CLIENT_IP_HEADER: "",
      PAYMENT_TIMEOUT_MINUTES: "",
      LOG_LEVEL: "",
      DATABASE_URL_TEST: "",
      PGPASSWORD: "",
      BETTER_AUTH_SECRET: "",
      BETTER_AUTH_SECRETS: "",
      BETTER_AUTH_URL: "",
      BETTER_AUTH_TRUSTED_ORIGINS: "",
      BETTER_AUTH_TELEMETRY: "",
      BETTER_AUTH_TELEMETRY_ENDPOINT: "",
      BETTER_AUTH_TELEMETRY_DEBUG: "",
    };
    for (const [name, value] of Object.entries({ ...base, ...overrides })) vi.stubEnv(name, value);
  }

  async function routeError(): Promise<unknown> {
    vi.resetModules();
    const route = await import("@/app/api/v1/auth/sign-in/route");
    try {
      await route.POST(new Request(`${APP_URL}/api/v1/auth/sign-in`, { method: "POST" }));
    } catch (error) {
      return error;
    }
    return undefined;
  }

  it("with a valid configuration nothing throws before the try (the library and the database client are built lazily)", async () => {
    stubEnv({});
    vi.resetModules();
    const { getAuthRuntime } = await import("@/server/auth/routes");
    expect(() => getAuthRuntime()).not.toThrow();
  });

  for (const [label, overrides] of [
    ["a library variable holding a secret", { BETTER_AUTH_SECRETS: `1:${CANARY}-rotated` }],
    ["a weak AUTH_SECRET", { AUTH_SECRET: `${CANARY}${"Z".repeat(30)}` }],
    ["a short AUTH_SECRET", { AUTH_SECRET: CANARY }],
    ["an invalid APP_URL", { APP_URL: `ftp://${CANARY}.example.test` }],
    ["a database URL of another scheme", { DATABASE_URL: `mysql://shop:${CANARY}@db:3306/x` }],
  ] as const) {
    it(`${label}: the route throws EnvValidationError and no part of the value is in its text`, async () => {
      stubEnv(overrides);
      const error = await routeError();
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).name).toBe("EnvValidationError");
      const text = [String(error), (error as Error).stack ?? "", JSON.stringify(error)].join("\n");
      expect(text).not.toContain(CANARY);
    });
  }
});
