import { connection } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getEnv } from "./env";
import { forbidden } from "./errors";
import { ok } from "./http";
import { handlePublicGet } from "./public-get";
import { handleRequest, requestIdTrust } from "./request-frame";

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("./env", () => ({ getEnv: vi.fn() }));
const connectionMock = vi.mocked(connection);
const getEnvMock = vi.mocked(getEnv);

const CLIENT_ID = "client-chosen-id-123";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function post(): Request {
  return new Request("http://localhost/api/v1/cart/items", {
    method: "POST",
    headers: { "X-Request-Id": CLIENT_ID, "Content-Type": "application/json" },
    body: "{}",
  });
}

function useProxy(config: { trustedProxyHops: number; trustedClientIpHeader?: string }) {
  getEnvMock.mockReturnValue({ trustedProxy: config } as ReturnType<typeof getEnv>);
}

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  connectionMock.mockReset();
  connectionMock.mockResolvedValue(undefined);
  useProxy({ trustedProxyHops: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
  getEnvMock.mockReset();
});

describe("handleRequest (CR-83)", () => {
  it("frames a guarded mutation: a guard refusal in run becomes the envelope", async () => {
    const response = await handleRequest(post(), async () => {
      throw forbidden();
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.requestId).toMatch(UUID);
    expect(body.error.requestId).toBe(response.headers.get("X-Request-Id"));
  });

  it("turns a failure to build a runtime inside run into a 500 with this request's id", async () => {
    const response = await handleRequest(post(), async () => {
      throw new Error("APP_URL is missing: secret-config-detail");
    });
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("secret-config-detail");
    expect(JSON.parse(text)).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
    expect(response.headers.get("X-Request-Id")).toMatch(UUID);
  });

  it("awaits connection() outside the try: the interruption is not turned into a 500", async () => {
    const interruption = new Error("needs to bail out of prerendering");
    connectionMock.mockRejectedValue(interruption);
    const run = vi.fn();
    await expect(handleRequest(post(), run)).rejects.toBe(interruption);
    expect(run).not.toHaveBeenCalled();
  });

  it("hands run the request id and a logger", async () => {
    let seen: { requestId: string; hasLog: boolean } | undefined;
    const response = await handleRequest(post(), async ({ requestId, log }) => {
      seen = { requestId, hasLog: typeof log.info === "function" };
      return ok(null, { requestId });
    });
    expect(seen?.hasLog).toBe(true);
    expect(response.headers.get("X-Request-Id")).toBe(seen?.requestId);
  });
});

describe("requestIdTrust: the one source of the trust setting", () => {
  it("reads getEnv().trustedProxy", () => {
    useProxy({ trustedProxyHops: 0 });
    expect(requestIdTrust()).toBe(false);
    useProxy({ trustedProxyHops: 1 });
    expect(requestIdTrust()).toBe(true);
    useProxy({ trustedProxyHops: 0, trustedClientIpHeader: "Fly-Client-IP" });
    expect(requestIdTrust()).toBe(true);
  });

  it("is false when the configuration cannot be read", () => {
    getEnvMock.mockImplementation(() => {
      throw new Error("invalid environment");
    });
    expect(requestIdTrust()).toBe(false);
  });

  it("decides the id of handleRequest and of handlePublicGet alike", async () => {
    useProxy({ trustedProxyHops: 1 });
    const echo = async ({ requestId }: { requestId: string }) => ok(null, { requestId });
    expect((await handleRequest(post(), echo)).headers.get("X-Request-Id")).toBe(CLIENT_ID);
    const get = new Request("http://localhost/api/v1/products", {
      headers: { "X-Request-Id": CLIENT_ID },
    });
    expect((await handlePublicGet(get, echo)).headers.get("X-Request-Id")).toBe(CLIENT_ID);
  });
});
