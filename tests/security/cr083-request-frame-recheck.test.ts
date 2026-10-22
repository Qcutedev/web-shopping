/**
 * Security review of the CR-83 change (commits 6cb6466 backend-api, 0769f7c auth), 2026-10-13.
 * Owner: security. Review: docs/reviews/T-020-T-018-security.md, section "CR-83".
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 * Pure: no database, no network. The configuration is stubbed per case.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Cases in this file re-import the auth module after `vi.resetModules()`. A cold import of the
// library takes several seconds when the whole security project runs in parallel, and the 5 s
// default timed out in session 102 (flake noted in SEC-080). The assertions are unchanged.
vi.setConfig({ testTimeout: 30_000 });

// Outside a Next.js request `connection()` has no work to do (the session route and the frame
// await it first).
vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));

const CANARY = "Zq7frameCanary";
const APP_URL = "https://shop.example.test";
const DATABASE_URL = "postgresql://shop:Zq7dbPw@db.example.test:5432/shop?schema=public";
const GOOD_SECRET = "Kd2Xw9Lm4Rt6Pn3bYc5Hj8Vz7Qs1Gf0U";
const ROOT = process.cwd();
/** Required in production since c817572 (T-041); absolute on every platform. */
const UPLOAD_DIR = resolve("/srv/shop-uploads");

function stubEnv(overrides: Record<string, string>) {
  const base: Record<string, string> = {
    NODE_ENV: "production",
    APP_URL,
    DATABASE_URL,
    AUTH_SECRET: GOOD_SECRET,
    TRUSTED_PROXY_HOPS: "0",
    UPLOAD_DIR,
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

const BAD_CONFIGURATIONS: [string, Record<string, string>][] = [
  ["a library variable holding a secret", { BETTER_AUTH_SECRETS: `1:${CANARY}-rotated` }],
  ["a weak AUTH_SECRET", { AUTH_SECRET: `${CANARY}${"Z".repeat(30)}` }],
  ["a short AUTH_SECRET", { AUTH_SECRET: CANARY }],
  ["an invalid APP_URL", { APP_URL: `ftp://${CANARY}.example.test` }],
  ["a database URL of another scheme", { DATABASE_URL: `mysql://shop:${CANARY}@db:3306/x` }],
];

let lines: string[] = [];

beforeEach(() => {
  lines = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("CR-83 review: the auth runtime is built inside each handler's try", () => {
  const routeFiles = ["session", "sign-in", "sign-out", "sign-up"].map((name) =>
    join(ROOT, "src", "app", "api", "v1", "auth", name, "route.ts"),
  );

  for (const path of routeFiles) {
    it(`${path.slice(ROOT.length + 1)}: passes getAuthRuntime itself, never its result`, () => {
      const source = readFileSync(path, "utf8");
      expect(source).not.toMatch(/getAuthRuntime\s*\(/);
      expect(source).toMatch(/handle\w+\(request, getAuthRuntime\)/);
    });
  }

  it("every exported handler in routes.ts builds the runtime after its outer try opens", () => {
    const source = readFileSync(join(ROOT, "src", "server", "auth", "routes.ts"), "utf8");
    const starts = [...source.matchAll(/export async function (handle\w+)\(/g)];
    expect(starts.map((match) => match[1])).toEqual([
      "handleSignUp",
      "handleSignIn",
      "handleSignOut",
      "handleGetSession",
    ]);
    for (const [index, match] of starts.entries()) {
      const end = starts[index + 1]?.index ?? source.length;
      const body = source.slice(match.index, end);
      const tryAt = body.indexOf("try {");
      const openAt = body.indexOf("open(request, source,");
      expect(tryAt, match[1]).toBeGreaterThan(0);
      expect(openAt, match[1]).toBeGreaterThan(tryAt);
      expect(body.slice(0, tryAt), match[1]).not.toMatch(/source\(|getAuthRuntime|getEnv\(/);
    }
  });

  for (const [label, overrides] of BAD_CONFIGURATIONS) {
    it(`${label}: getAuthRuntime throws EnvValidationError and its text holds no part of the value`, async () => {
      stubEnv(overrides);
      vi.resetModules();
      const { getAuthRuntime } = await import("@/server/auth/routes");
      let thrown: unknown;
      try {
        getAuthRuntime();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).name).toBe("EnvValidationError");
      const text = [String(thrown), (thrown as Error).stack ?? "", JSON.stringify(thrown)].join(
        "\n",
      );
      expect(text).not.toContain(CANARY);
    });
  }

  for (const name of ["session", "sign-in", "sign-out", "sign-up"] as const) {
    it(`${name}: with the configuration refused, a client-chosen X-Request-Id is not reused, even with TRUSTED_PROXY_HOPS=1`, async () => {
      stubEnv({ TRUSTED_PROXY_HOPS: "1", AUTH_SECRET: CANARY });
      vi.resetModules();
      const loaders = {
        session: () => import("@/app/api/v1/auth/session/route"),
        "sign-in": () => import("@/app/api/v1/auth/sign-in/route"),
        "sign-out": () => import("@/app/api/v1/auth/sign-out/route"),
        "sign-up": () => import("@/app/api/v1/auth/sign-up/route"),
      };
      const route = (await loaders[name]()) as Record<
        string,
        ((request: Request) => Promise<Response>) | undefined
      >;
      const handler = route.GET ?? route.POST;
      if (handler === undefined) throw new Error(`no handler in ${name}`);
      const sent = `client-${CANARY}-0001`;
      const response = await handler(
        new Request(`${APP_URL}/api/v1/auth/${name}`, {
          method: name === "session" ? "GET" : "POST",
          headers: { "X-Request-Id": sent, Origin: APP_URL, "Content-Type": "application/json" },
          ...(name === "session" ? {} : { body: "{}" }),
        }),
      );
      expect(response.status).toBe(500);
      const body = await response.text();
      expect(body).not.toContain(CANARY);
      expect(response.headers.get("x-request-id")).not.toBe(sent);
      expect(lines).toHaveLength(1);
      expect(lines[0]).not.toContain(CANARY);
    });
  }
});

describe("CR-83 review: handleRequest", () => {
  it("everything run throws becomes the envelope; nothing of the error reaches body or log", async () => {
    stubEnv({});
    vi.resetModules();
    const { handleRequest } = await import("@/server/request-frame");
    const response = await handleRequest(new Request(`${APP_URL}/x`), () => {
      throw Object.assign(new Error(`failed with ${CANARY}`), { detail: CANARY });
    });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(CANARY);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(CANARY);
  });

  it("a client-chosen X-Request-Id is reused only under a trusted proxy configuration, and never when the configuration is refused", async () => {
    const sent = "client-chosen-0001";
    const answerId = async () => {
      vi.resetModules();
      const { handleRequest } = await import("@/server/request-frame");
      const { ok } = await import("@/server/http");
      const response = await handleRequest(
        new Request(`${APP_URL}/x`, { headers: { "X-Request-Id": sent } }),
        ({ requestId }) => Promise.resolve(ok(null, { requestId })),
      );
      return response.headers.get("x-request-id");
    };
    stubEnv({});
    expect(await answerId()).not.toBe(sent);
    stubEnv({ TRUSTED_PROXY_HOPS: "1", AUTH_SECRET: CANARY });
    expect(await answerId()).not.toBe(sent);
    stubEnv({ TRUSTED_PROXY_HOPS: "1" });
    expect(await answerId()).toBe(sent);
  });

  it("the frame reads the trust setting in one place: request-frame.ts and routes.ts use no other source", () => {
    const frame = readFileSync(join(ROOT, "src", "server", "request-frame.ts"), "utf8");
    expect(frame.match(/trustsIncomingRequestId\(/g)).toHaveLength(1);
    const publicGet = readFileSync(join(ROOT, "src", "server", "public-get.ts"), "utf8");
    expect(publicGet).not.toMatch(/getEnv|trustsIncomingRequestId|resolveRequestId/);
    expect(publicGet).toMatch(/return handleRequest\(request, run\);/);
  });
});
