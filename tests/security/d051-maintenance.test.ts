/**
 * Security review of D-051 (scheduled maintenance endpoint, commits 4c460df..bc3717a),
 * 2026-10-30. Owner: security. Review: docs/reviews/D-051-maintenance-security.md.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 * No database, no server. The route handler, the authorization, and the environment parser are
 * called in process with the jobs stubbed; the workflow, route, and migration files are read as
 * text.
 *
 *   it(...)        behaviour checked on 2026-10-30 that holds. A failure is a regression.
 *   it.fails(...)  demonstrates an open finding (SEC-097, SEC-099, SEC-100, SEC-101; SEC-098 was
 *                  fixed during the review and is a plain `it`). It turns red when the flaw
 *                  is fixed; the fix converts it to a plain `it`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MaintenanceJobs } from "@/modules/maintenance";
import {
  bearerToken,
  constantTimeEqual,
  isAuthorizedMaintenanceRequest,
  MAX_AUTHORIZATION_HEADER_LENGTH,
} from "@/modules/maintenance/authorization";
import {
  MAX_UPLOAD_BODY_BYTES,
  MAX_UPLOAD_FILE_BYTES,
  PLATFORM_REQUEST_BODY_LIMIT_BYTES,
} from "@/modules/uploads/schema";
import { CRON_SECRET_PATTERN } from "@/server/env";
import { createMaintenanceJobs } from "@/server/maintenance-jobs";

import { POST } from "@/app/api/v1/internal/maintenance/route";

const ROOT = join(__dirname, "..", "..");
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

// Made up, assembled at run time.
const SECRET = ["Qw8revw", "D051sec", "Rx4Lm7Np", "2Hb9Tc6Vz"].join("");

const config: { cronSecret?: string; paymentTimeoutMinutes: number } = {
  cronSecret: SECRET,
  paymentTimeoutMinutes: 15,
};

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/server/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/env")>();
  return {
    ...actual,
    getEnv: () => ({ trustedProxy: { trustedProxyHops: 0 }, ...config }),
  };
});
vi.mock("@/server/maintenance-jobs", () => ({ createMaintenanceJobs: vi.fn() }));

const createJobsMock = vi.mocked(createMaintenanceJobs);
let lines: string[] = [];

function stubJobs(): MaintenanceJobs {
  return {
    paymentTimeoutSweep: vi.fn(() => Promise.resolve({ found: 0, failed: 0, errored: 0 })),
    uploadCleanup: vi.fn(() =>
      Promise.resolve({ rowsDeleted: 0, filesDeleted: 0, filesMissing: 0, filesFailed: 0 }),
    ),
    sessionPurge: vi.fn(() => Promise.resolve({ sessions: 0, verifications: 0 })),
  };
}

function post(headers: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/v1/internal/maintenance", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  lines = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  config.cronSecret = SECRET;
  createJobsMock.mockReset();
  createJobsMock.mockImplementation(() => stubJobs());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("D-051 controls that hold", () => {
  it("refuses every request when no secret is configured, the right header included", async () => {
    config.cronSecret = undefined;
    const response = await POST(post({ authorization: `Bearer ${SECRET}` }));
    expect(response.status).toBe(401);
    expect(createJobsMock).not.toHaveBeenCalled();
  });

  it("refuses a request with a Cookie or an Origin header even with the right secret", async () => {
    const extras: Record<string, string>[] = [
      { cookie: "a=b" },
      { origin: "http://localhost:3000" },
    ];
    for (const extra of extras) {
      const response = await POST(post({ authorization: `Bearer ${SECRET}`, ...extra }));
      expect(response.status).toBe(401);
    }
    expect(createJobsMock).not.toHaveBeenCalled();
  });

  it("accepts the right secret and answers no-store with counts only", async () => {
    const response = await POST(post({ authorization: `Bearer ${SECRET}` }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain(SECRET);
  });

  it("never writes the presented or configured secret to the log", async () => {
    await POST(post({ authorization: `Bearer ${SECRET}` }));
    await POST(post({ authorization: `Bearer ${SECRET}x` }));
    await POST(post({ authorization: `Bearer ${SECRET.slice(0, 20)}` }));
    const all = lines.join("");
    expect(all).not.toContain(SECRET.slice(0, 16));
  });

  it("bounds the header before the regular expression and refuses a prefix or a longer value", () => {
    expect(bearerToken(`Bearer ${"a".repeat(257)}`)).toBeUndefined();
    expect(bearerToken(`Bearer ${"a".repeat(256)}`)).toBe("a".repeat(256));
    expect(MAX_AUTHORIZATION_HEADER_LENGTH).toBe(263);
    expect(
      isAuthorizedMaintenanceRequest(
        { get: (n) => (n === "authorization" ? `Bearer ${SECRET.slice(0, -1)}` : null) },
        SECRET,
      ),
    ).toBe(false);
    expect(constantTimeEqual("a", "a")).toBe(true);
    expect(constantTimeEqual("a", "ab")).toBe(false);
  });

  it("compares with timingSafeEqual on SHA-256 digests, not with ===", () => {
    const source = read("src/modules/maintenance/authorization.ts");
    expect(source).toMatch(/timingSafeEqual\(digest\(a\), digest\(b\)\)/);
    expect(source).not.toMatch(/presented\s*===\s*configuredSecret/);
  });

  it("the workflow has no token permissions, no third-party action, and no expression in run", () => {
    const workflow = read(".github/workflows/maintenance.yml");
    expect(workflow).toMatch(/^permissions: \{\}$/m);
    expect(workflow).not.toMatch(/^\s*-?\s*uses:/m);
    const run = workflow.slice(workflow.indexOf("run: |"));
    expect(run).not.toContain("${{");
    expect(workflow).not.toMatch(/pull_request_target|pull_request:/);
    // No redirect following: the secret is sent to MAINTENANCE_URL only.
    expect(run).not.toMatch(/\s(-L|--location)\b/);
  });

  it("the upload body cap stays under the platform request body limit", () => {
    expect(MAX_UPLOAD_FILE_BYTES).toBe(4_194_304);
    expect(MAX_UPLOAD_BODY_BYTES).toBeLessThan(PLATFORM_REQUEST_BODY_LIMIT_BYTES);
    expect(MAX_UPLOAD_BODY_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });
});

describe("SEC-097 CRON_SECRET may hold characters the workflow's curl config string alters", () => {
  // The workflow writes `header = "Authorization: Bearer %s"` into a curl config file. Inside
  // double quotes curl ends the value at `"` and reads `\` as an escape, so the header sent is
  // not the secret. The env rule accepts both characters.
  it.fails("the env rule refuses a double quote and a backslash in CRON_SECRET", () => {
    const quote = String.fromCodePoint(0x22);
    const backslash = String.fromCodePoint(0x5c);
    expect(CRON_SECRET_PATTERN.test(`${"A".repeat(32)}${quote}`)).toBe(false);
    expect(CRON_SECRET_PATTERN.test(`${"A".repeat(32)}${backslash}`)).toBe(false);
  });

  it("the workflow interpolates the secret into a quoted curl config value unescaped", () => {
    const workflow = read(".github/workflows/maintenance.yml");
    expect(workflow).toContain(`printf 'header = "Authorization: Bearer %s"\\n' "\${CRON_SECRET}"`);
  });
});

describe("SEC-098 the workflow retries a POST that reached the server (FIXED in bc3717a)", () => {
  it("curl does not re-send the maintenance POST after a 5xx or a timeout", () => {
    const workflow = read(".github/workflows/maintenance.yml");
    // curl --retry re-sends on a timeout and on HTTP 408, 429, 500, 502, 503, 504.
    expect(workflow).not.toMatch(/--retry\b/);
  });

  it("the client timeout is above the route's maxDuration, so a slow run is not cut short", () => {
    const workflow = read(".github/workflows/maintenance.yml");
    const route = read("src/app/api/v1/internal/maintenance/route.ts");
    const clientSeconds = Number(/--max-time (\d+)/.exec(workflow)?.[1]);
    const serverSeconds = Number(/export const maxDuration = (\d+);/.exec(route)?.[1]);
    expect(clientSeconds).toBeGreaterThan(serverSeconds);
  });
});

describe("SEC-099 refused requests are not rate limited and their line obeys LOG_LEVEL", () => {
  it.fails(
    "a burst of refused requests is cut off by a rate limit (429) or a bounded log",
    async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 200; i += 1) {
        const response = await POST(post({ authorization: "Bearer wrong" }));
        statuses.push(response.status);
      }
      const refusedLines = lines.filter((l) => l.includes("Maintenance request refused")).length;
      expect(statuses.includes(429) || refusedLines < 200).toBe(true);
    },
  );

  it.fails(
    "the refusal line is written through security(), which LOG_LEVEL does not filter",
    () => {
      const source = read("src/app/api/v1/internal/maintenance/route.ts");
      expect(source).toMatch(/\.security\(\s*"warn",\s*"Maintenance request refused"/);
    },
  );
});

describe("SEC-100 a scheduler that stops calling goes unnoticed", () => {
  it.fails("the workflow fails, not passes, when MAINTENANCE_URL or CRON_SECRET is missing", () => {
    const workflow = read(".github/workflows/maintenance.yml");
    const branch = workflow.slice(
      workflow.indexOf('if [ -z "${MAINTENANCE_URL}" ]'),
      workflow.indexOf("fi", workflow.indexOf('if [ -z "${MAINTENANCE_URL}" ]')),
    );
    expect(branch).not.toMatch(/exit 0/);
  });

  it.fails("something in the application reports how long ago the last maintenance run was", () => {
    const health = read("src/server/health.ts");
    expect(health).toMatch(/maintenance|sweep|lastRun/i);
  });
});

describe("SEC-101 the database still allows 5 MiB uploads after the limit became 4 MiB", () => {
  it.fails("a migration bounds Upload.sizeBytes by MAX_UPLOAD_FILE_BYTES", () => {
    const dir = join(ROOT, "prisma", "migrations");
    const sql = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => read(join("prisma", "migrations", e.name, "migration.sql")))
      .join("\n");
    const bounds = [...sql.matchAll(/"sizeBytes" BETWEEN 1 AND (\d+)/g)].map((m) => Number(m[1]));
    expect(bounds.at(-1)).toBe(MAX_UPLOAD_FILE_BYTES);
  });
});
