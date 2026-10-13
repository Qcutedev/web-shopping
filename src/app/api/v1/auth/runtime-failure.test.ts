/**
 * CR-83: the four auth route files hand `getAuthRuntime` itself to their handler, which builds
 * the runtime inside its `try`. A failure to build it (invalid configuration, the library
 * refusing its options) is then the standard 500 envelope with the class name in the log, not
 * an error thrown out of the route that Next.js prints with message and stack.
 *
 * No database is reached: `getAuthRuntime` is replaced by a function that throws.
 */
import { BetterAuthError } from "better-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CANARY = "Zq7SECRETcanary";
const APP_ORIGIN = "https://shop.example.test";
/** Well-formed, so it would be used if the incoming id were trusted. */
const CLIENT_REQUEST_ID = "client-chosen-id-1";

vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));

vi.mock("@/server/auth/routes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/routes")>();
  return {
    ...actual,
    getAuthRuntime: (): never => {
      throw new BetterAuthError(`Invalid BETTER_AUTH_SECRETS entry: "${CANARY}-rotated"`);
    },
  };
});

interface LogLine {
  level: string;
  requestId?: string;
  err?: unknown;
}

let lines: string[] = [];

beforeEach(() => {
  lines = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function request(path: string, method: "GET" | "POST"): Request {
  const headers = new Headers({ "x-request-id": CLIENT_REQUEST_ID });
  if (method === "POST") {
    headers.set("origin", APP_ORIGIN);
    headers.set("content-type", "application/json");
  }
  return new Request(`${APP_ORIGIN}${path}`, {
    method,
    headers,
    ...(method === "POST" ? { body: "{}" } : {}),
  });
}

async function expectStandardFailure(response: Response): Promise<void> {
  expect(response.status).toBe(500);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const text = await response.text();
  expect(text).not.toContain(CANARY);
  const body = JSON.parse(text) as { error: { code: string; requestId: string } };
  expect(body.error.code).toBe("INTERNAL_ERROR");
  // Without the validated proxy configuration the incoming id is not trusted.
  expect(body.error.requestId).not.toBe(CLIENT_REQUEST_ID);
  expect(response.headers.get("x-request-id")).toBe(body.error.requestId);

  expect(lines).toHaveLength(1);
  const line = lines[0] ?? "";
  expect(line).not.toContain(CANARY);
  expect(line).not.toContain("BETTER_AUTH_SECRETS");
  const parsed = JSON.parse(line) as LogLine;
  expect(parsed.level).toBe("error");
  expect(parsed.requestId).toBe(body.error.requestId);
  expect(parsed.err).toEqual({ errorClass: "BetterAuthError" });
}

describe("an auth route whose runtime cannot be built answers the standard 500 (CR-83)", () => {
  it("POST /api/v1/auth/sign-up", async () => {
    const { POST } = await import("./sign-up/route");
    await expectStandardFailure(await POST(request("/api/v1/auth/sign-up", "POST")));
  });

  it("POST /api/v1/auth/sign-in", async () => {
    const { POST } = await import("./sign-in/route");
    await expectStandardFailure(await POST(request("/api/v1/auth/sign-in", "POST")));
  });

  it("POST /api/v1/auth/sign-out", async () => {
    const { POST } = await import("./sign-out/route");
    await expectStandardFailure(await POST(request("/api/v1/auth/sign-out", "POST")));
  });

  it("GET /api/v1/auth/session", async () => {
    const { GET } = await import("./session/route");
    await expectStandardFailure(await GET(request("/api/v1/auth/session", "GET")));
  });
});
