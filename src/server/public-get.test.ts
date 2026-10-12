import { connection } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getEnv } from "./env";
import { notFound } from "./errors";
import { ok } from "./http";
import { handlePublicGet } from "./public-get";

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("./env", () => ({ getEnv: vi.fn() }));
const connectionMock = vi.mocked(connection);
const getEnvMock = vi.mocked(getEnv);

const CLIENT_ID = "client-chosen-id-123";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function request(): Request {
  return new Request("http://localhost/api/v1/products", {
    headers: { "X-Request-Id": CLIENT_ID },
  });
}

function useProxy(config: { trustedProxyHops: number; trustedClientIpHeader?: string }) {
  getEnvMock.mockReturnValue({ trustedProxy: config } as ReturnType<typeof getEnv>);
}

let stdout: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  connectionMock.mockReset();
  connectionMock.mockResolvedValue(undefined);
  useProxy({ trustedProxyHops: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
  getEnvMock.mockReset();
});

describe("handlePublicGet", () => {
  it("awaits connection() before it runs anything", async () => {
    const run = vi.fn(async ({ requestId }: { requestId: string }) => ok(null, { requestId }));
    await handlePublicGet(request(), run);
    expect(connectionMock).toHaveBeenCalledTimes(1);
    expect(connectionMock.mock.invocationCallOrder[0]).toBeLessThan(
      run.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("lets the build's interruption through: run is not called and nothing is logged", async () => {
    const interruption = new Error("needs to bail out of prerendering");
    connectionMock.mockRejectedValue(interruption);
    const run = vi.fn();
    await expect(handlePublicGet(request(), run)).rejects.toBe(interruption);
    expect(run).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
  });

  it("returns what run returns, with the generated request id", async () => {
    let seen = "";
    const response = await handlePublicGet(request(), async ({ requestId }) => {
      seen = requestId;
      return ok({ a: 1 }, { requestId });
    });
    expect(response.status).toBe(200);
    expect(seen).toMatch(UUID);
    expect(response.headers.get("X-Request-Id")).toBe(seen);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ data: { a: 1 } });
  });

  it("ignores a client request id when no proxy is trusted (SR-03)", async () => {
    const response = await handlePublicGet(request(), async ({ requestId }) =>
      ok(null, { requestId }),
    );
    expect(response.headers.get("X-Request-Id")).not.toBe(CLIENT_ID);
  });

  it("reuses a well-formed incoming id behind a trusted proxy", async () => {
    useProxy({ trustedProxyHops: 1 });
    const response = await handlePublicGet(request(), async ({ requestId }) =>
      ok(null, { requestId }),
    );
    expect(response.headers.get("X-Request-Id")).toBe(CLIENT_ID);
  });

  it("generates the id when the configuration cannot be read", async () => {
    getEnvMock.mockImplementation(() => {
      throw new Error("invalid environment");
    });
    const response = await handlePublicGet(request(), async ({ requestId }) =>
      ok(null, { requestId }),
    );
    expect(response.headers.get("X-Request-Id")).toMatch(UUID);
  });

  it("maps an AppError to its envelope", async () => {
    const response = await handlePublicGet(request(), async () => {
      throw notFound();
    });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.requestId).toBe(response.headers.get("X-Request-Id"));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("turns anything else into a 500 that discloses nothing", async () => {
    const response = await handlePublicGet(request(), async () => {
      throw new Error('relation "Product" does not exist at SELECT secret');
    });
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("Product");
    expect(text).not.toContain("SELECT");
    expect(JSON.parse(text)).toMatchObject({
      error: { code: "INTERNAL_ERROR", details: {} },
    });
  });
});
