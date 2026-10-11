import { connection } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkHealth, type HealthReport } from "@/server/health";

import { GET } from "./route";

// The handler alone: the framework's `connection` and the health check are replaced, so no
// server runs and nothing reaches the database layer. The check has its own tests in
// src/server/health.test.ts; the endpoint in a running server is exercised by the runs recorded
// in docs/DEPLOYMENT.md, "Health endpoint".
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/server/health", () => ({ checkHealth: vi.fn() }));

const connectionMock = vi.mocked(connection);
const checkHealthMock = vi.mocked(checkHealth);

const UP: HealthReport = { status: "ok", database: "up" };
const DOWN: HealthReport = { status: "unavailable", database: "down" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The framework hands the handler the request; the handler declares no parameter for it. */
const handle = GET as (request?: Request) => Promise<Response>;

beforeEach(() => {
  connectionMock.mockReset();
  checkHealthMock.mockReset();
  connectionMock.mockResolvedValue(undefined);
});

describe("GET /api/health", () => {
  it("answers 200 with exactly the body of a passing check", async () => {
    checkHealthMock.mockResolvedValue(UP);
    const response = await handle();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"status":"ok","database":"up"}');
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("answers 503 with exactly the body of a failing check", async () => {
    checkHealthMock.mockResolvedValue(DOWN);
    const response = await handle();
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"status":"unavailable","database":"down"}');
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it.each([
    ["200", UP],
    ["503", DOWN],
  ])("is never stored: Cache-Control is no-store on the %s", async (_status, report) => {
    checkHealthMock.mockResolvedValue(report);
    const response = await handle();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    ["200", UP],
    ["503", DOWN],
  ])(
    "generates the request id of the %s and gives the same one to the check",
    async (_status, report) => {
      checkHealthMock.mockResolvedValue(report);
      const response = await handle();
      const requestId = response.headers.get("x-request-id");
      expect(requestId).toMatch(UUID);
      expect(checkHealthMock.mock.calls).toEqual([[{ requestId }]]);
    },
  );

  it("generates a new request id for every request", async () => {
    checkHealthMock.mockResolvedValue(UP);
    const ids = new Set<string | null>();
    for (let request = 0; request < 20; request += 1) {
      ids.add((await handle()).headers.get("x-request-id"));
    }
    expect(ids.size).toBe(20);
    expect(ids.has(null)).toBe(false);
  });

  // SR-03: the endpoint is public, so a client-chosen id is never used, however well formed.
  it.each([
    ["200", UP],
    ["503", DOWN],
  ])("ignores a request id sent by the client on the %s", async (_status, report) => {
    checkHealthMock.mockResolvedValue(report);
    const clientId = "client-chosen-id-0001";
    const response = await handle(
      new Request("https://shop.example.test/api/health", {
        headers: { "X-Request-Id": clientId },
      }),
    );
    const requestId = response.headers.get("x-request-id");
    expect(requestId).toMatch(UUID);
    expect(requestId).not.toBe(clientId);
    expect(JSON.stringify(checkHealthMock.mock.calls)).not.toContain(clientId);
    expect(JSON.stringify([...response.headers])).not.toContain(clientId);
    expect(await response.text()).not.toContain(clientId);
  });

  // With Cache Components a GET handler that reads no request-time data is prerendered at build
  // time. `connection()` is what prevents that, and only when it is awaited before the check.
  it("waits for connection() before it runs the check", async () => {
    let release!: () => void;
    connectionMock.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    checkHealthMock.mockResolvedValue(UP);
    const pending = handle();
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    expect(connectionMock).toHaveBeenCalledTimes(1);
    expect(checkHealthMock).not.toHaveBeenCalled();
    release();
    expect((await pending).status).toBe(200);
    expect(checkHealthMock).toHaveBeenCalledTimes(1);
    expect(connectionMock.mock.invocationCallOrder[0]).toBeLessThan(
      checkHealthMock.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("does not run the check and does not answer when connection() rejects", async () => {
    // What the framework does to stop a prerender: the rejection must reach it untouched.
    const bailout = new Error("bail out of prerendering");
    connectionMock.mockRejectedValue(bailout);
    await expect(handle()).rejects.toBe(bailout);
    expect(checkHealthMock).not.toHaveBeenCalled();
  });

  it("puts nothing in the response but the two fixed fields and the three headers", async () => {
    checkHealthMock.mockResolvedValue(DOWN);
    const response = await handle();
    expect([...response.headers.keys()].sort()).toEqual([
      "cache-control",
      "content-type",
      "x-request-id",
    ]);
    expect(Object.keys((await response.json()) as object).sort()).toEqual(["database", "status"]);
  });
});
