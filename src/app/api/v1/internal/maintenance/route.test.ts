/**
 * Route-level tests of `POST /api/v1/internal/maintenance` (docs/API_CONTRACTS.md section 5.11).
 *
 * No database is reached: the jobs are stubs (src/server/maintenance-jobs.ts is mocked) and the
 * configuration is a mock. The authorization and the service are the real ones.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAINTENANCE_REFUSED_RULE, type MaintenanceJobs } from "@/modules/maintenance";
import { DEFAULT_LOG_LEVEL, setLogLevel } from "@/server/logger";
import { createMaintenanceJobs } from "@/server/maintenance-jobs";

import * as routeModule from "./route";

// Made up, assembled at run time.
const SECRET = ["Zq7canary", "Cr0nS3cr", "Kd2Xw9Lm", "4Rt6Pn3b"].join("");
const URL_ = "http://localhost:3000/api/v1/internal/maintenance";

const config: {
  cronSecret?: string;
  paymentTimeoutMinutes: number;
  trustedProxy: { trustedProxyHops: number };
} = {
  cronSecret: SECRET,
  paymentTimeoutMinutes: 15,
  trustedProxy: { trustedProxyHops: 0 },
};

/** The process-wide count of refused requests (SEC-099, src/modules/maintenance/refusal-limit.ts). */
const REFUSAL_LIMITER_KEY = Symbol.for("marketplace.maintenance.refusalLimiter");

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/server/env", () => ({
  getEnv: () => ({ ...config }),
}));
vi.mock("@/server/maintenance-jobs", () => ({ createMaintenanceJobs: vi.fn() }));

const { POST } = routeModule;
const createJobsMock = vi.mocked(createMaintenanceJobs);

let jobs: MaintenanceJobs;
let lines: string[] = [];

function stubJobs(overrides: Partial<MaintenanceJobs> = {}): MaintenanceJobs {
  return {
    paymentTimeoutSweep: vi.fn(() => Promise.resolve({ found: 1, failed: 1, errored: 0 })),
    uploadCleanup: vi.fn(() =>
      Promise.resolve({ rowsDeleted: 2, filesDeleted: 2, filesMissing: 0, filesFailed: 0 }),
    ),
    sessionPurge: vi.fn(() => Promise.resolve({ sessions: 3, verifications: 0 })),
    ...overrides,
  };
}

beforeEach(() => {
  lines = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  config.cronSecret = SECRET;
  config.paymentTimeoutMinutes = 15;
  config.trustedProxy = { trustedProxyHops: 0 };
  delete (globalThis as Record<symbol, unknown>)[REFUSAL_LIMITER_KEY];
  jobs = stubJobs();
  createJobsMock.mockReset();
  createJobsMock.mockImplementation(() => jobs);
});

afterEach(() => {
  vi.restoreAllMocks();
  setLogLevel(DEFAULT_LOG_LEVEL);
});

function post(headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }): Request {
  return new Request(URL_, { method: "POST", headers });
}

function noJobRan(): void {
  expect(createJobsMock).not.toHaveBeenCalled();
  expect(jobs.paymentTimeoutSweep).not.toHaveBeenCalled();
  expect(jobs.uploadCleanup).not.toHaveBeenCalled();
  expect(jobs.sessionPurge).not.toHaveBeenCalled();
}

async function expectUnauthenticated(response: Response): Promise<void> {
  expect(response.status).toBe(401);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = (await response.json()) as { error: Record<string, unknown> };
  expect(body).toEqual({
    error: {
      code: "UNAUTHENTICATED",
      message: "Authentication is required.",
      details: {},
      requestId: response.headers.get("x-request-id"),
    },
  });
}

describe("/api/v1/internal/maintenance: the route module", () => {
  it("exports POST and maxDuration only", () => {
    expect(Object.keys(routeModule).sort()).toEqual(["POST", "maxDuration"]);
    expect(routeModule.maxDuration).toBe(60);
  });

  it("is thin: no database, no session, no body read", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "route.ts"), "utf8");
    expect(source).not.toMatch(/server\/db|requireActor|getActor|server\/auth/);
    expect(source).not.toMatch(/request\.(json|text|formData|arrayBuffer|blob)\(/);
  });
});

describe("POST /api/v1/internal/maintenance: authorization", () => {
  it("runs the jobs with the right secret and answers 200 with counts only", async () => {
    config.paymentTimeoutMinutes = 7;
    const response = await POST(post());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      data: {
        ok: true,
        jobs: {
          paymentTimeoutSweep: { ok: true, found: 1, failed: 1, errored: 0 },
          uploadCleanup: {
            ok: true,
            rowsDeleted: 2,
            filesDeleted: 2,
            filesMissing: 0,
            filesFailed: 0,
          },
          sessionPurge: { ok: true, removedSessions: 3, removedVerifications: 0 },
        },
      },
    });
    expect(createJobsMock.mock.calls).toEqual([[{ paymentTimeoutMinutes: 7 }]]);
  });

  it("answers 401 with no detail to a request without Authorization, and runs nothing", async () => {
    await expectUnauthenticated(await POST(post({})));
    noJobRan();
  });

  it.each([
    ["a wrong secret", `Bearer ${SECRET.slice(0, -1)}X`],
    ["an empty bearer", "Bearer "],
    ["another scheme", `Basic ${SECRET}`],
    ["the bare secret", SECRET],
  ])("answers the same 401 to %s, and runs nothing", async (_label, value) => {
    await expectUnauthenticated(await POST(post({ authorization: value })));
    noJobRan();
  });

  it("answers 401 to every request when CRON_SECRET is not configured", async () => {
    config.cronSecret = undefined;
    await expectUnauthenticated(await POST(post()));
    noJobRan();
  });

  it("ignores session cookies: a cookie never authorizes, and the right secret with one is refused", async () => {
    await expectUnauthenticated(await POST(post({ cookie: "better-auth.session_token=abc" })));
    await expectUnauthenticated(
      await POST(post({ authorization: `Bearer ${SECRET}`, cookie: "a=b" })),
    );
    noJobRan();
  });

  it("refuses a browser request: the right secret with an Origin header is 401", async () => {
    await expectUnauthenticated(
      await POST(post({ authorization: `Bearer ${SECRET}`, origin: "http://localhost:3000" })),
    );
    noJobRan();
  });

  it("never writes the secret or the header to the log", async () => {
    await POST(post({ authorization: `Bearer ${SECRET}x` }));
    await POST(post());
    expect(lines.join("")).not.toContain("Zq7canary");
    expect(lines.join("")).toContain("Maintenance request refused");
  });
});

describe("POST /api/v1/internal/maintenance: refusals are rate limited (SEC-099)", () => {
  const refusalLines = (): number =>
    lines.filter((line) => line.includes("Maintenance request refused")).length;

  async function useUpRefusals(headers: Record<string, string> = {}): Promise<void> {
    for (let index = 0; index < MAINTENANCE_REFUSED_RULE.limit; index += 1) {
      await expectUnauthenticated(await POST(post({ authorization: "Bearer wrong", ...headers })));
    }
  }

  it("answers 429 RATE_LIMITED with Retry-After past the rule, and writes no line for it", async () => {
    await useUpRefusals();
    expect(refusalLines()).toBe(MAINTENANCE_REFUSED_RULE.limit);
    const response = await POST(post({ authorization: "Bearer wrong" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const retryAfter = Number(response.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    const body = (await response.json()) as { error: Record<string, unknown> };
    expect(body.error).toMatchObject({ code: "RATE_LIMITED", details: {} });
    expect(refusalLines()).toBe(MAINTENANCE_REFUSED_RULE.limit);
    noJobRan();
  });

  it("bounds the refusal lines of a burst by the rule", async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 50; index += 1) {
      statuses.push((await POST(post({ authorization: "Bearer wrong" }))).status);
    }
    expect(statuses.filter((status) => status === 401)).toHaveLength(
      MAINTENANCE_REFUSED_RULE.limit,
    );
    expect(statuses.filter((status) => status === 429)).toHaveLength(
      50 - MAINTENANCE_REFUSED_RULE.limit,
    );
    expect(refusalLines()).toBe(MAINTENANCE_REFUSED_RULE.limit);
  });

  it("never locks the scheduler out: the right secret runs the jobs after the rule is used up", async () => {
    await useUpRefusals();
    expect((await POST(post({ authorization: "Bearer wrong" }))).status).toBe(429);
    const response = await POST(post());
    expect(response.status).toBe(200);
    expect(createJobsMock).toHaveBeenCalledTimes(1);
  });

  it("does not count a request with the right secret", async () => {
    for (let index = 0; index < 2 * MAINTENANCE_REFUSED_RULE.limit; index += 1) {
      expect((await POST(post())).status).toBe(200);
    }
    await useUpRefusals();
  });

  it("counts per client address when a proxy is trusted", async () => {
    config.trustedProxy = { trustedProxyHops: 1 };
    await useUpRefusals({ "x-forwarded-for": "203.0.113.7" });
    expect(
      (await POST(post({ authorization: "Bearer wrong", "x-forwarded-for": "203.0.113.7" })))
        .status,
    ).toBe(429);
    await expectUnauthenticated(
      await POST(post({ authorization: "Bearer wrong", "x-forwarded-for": "198.51.100.4" })),
    );
  });

  it("writes the refusal line through security(), so LOG_LEVEL=error does not hide it", async () => {
    setLogLevel("error");
    await expectUnauthenticated(await POST(post({ authorization: "Bearer wrong" })));
    const line = lines.find((each) => each.includes("Maintenance request refused"));
    expect(line).toBeDefined();
    const parsed = JSON.parse(line ?? "{}") as Record<string, unknown>;
    expect(parsed).toMatchObject({ level: "warn", component: "maintenance" });
    expect(typeof parsed["requestId"]).toBe("string");
  });
});

describe("POST /api/v1/internal/maintenance: job failures", () => {
  it("answers 500 INTERNAL_ERROR with nothing in it when a job failed, after running the others", async () => {
    jobs = stubJobs({ uploadCleanup: () => Promise.reject(new Error("Zq7canary storage path")) });
    const response = await POST(post());
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: Record<string, unknown> };
    expect(body.error).toMatchObject({
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
      details: {},
    });
    expect(jobs.paymentTimeoutSweep).toHaveBeenCalledTimes(1);
    expect(jobs.sessionPurge).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(body)).not.toContain("Zq7canary");
    expect(lines.join("")).not.toContain("Zq7canary");
  });
});
