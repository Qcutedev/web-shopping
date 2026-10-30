/**
 * SECURITY.md SEC-100 remediation (b) against the worker's real test database: the maintenance
 * run records itself in the single `MaintenanceStatus` row (DATA_MODEL.md section 6.19), and the
 * health check reads it and writes a `warn` line when the last success is stale, without changing
 * its answer (docs/API_CONTRACTS.md, `GET /api/health`: body and status code unchanged).
 *
 * The route module is called in process with a real `Request`; the jobs are the real ones.
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/v1/internal/maintenance/route";
import {
  assessMaintenanceStatus,
  readMaintenanceStatus,
  recordMaintenanceRun,
} from "@/modules/maintenance";
import { UPLOAD_ROOT_MARKER } from "@/modules/uploads";
import { db } from "@/server/db";
import { createHealthCheck } from "@/server/health";
import { createLogger } from "@/server/logger";

import { APP_URL, resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";

// Generated per run, never written in the repository.
const CRON_SECRET = randomBytes(32).toString("base64url");

let uploadDir: string;

beforeAll(async () => {
  stubAuthEnvironment();
  process.env["CRON_SECRET"] = CRON_SECRET;
  delete process.env["MAINTENANCE_VIA_HTTP"];
  uploadDir = await mkdtemp(join(tmpdir(), "maintenance-status-"));
  process.env["UPLOAD_DIR"] = uploadDir;
});

afterAll(async () => {
  delete process.env["CRON_SECRET"];
  delete process.env["UPLOAD_DIR"];
  await rm(uploadDir, { recursive: true, force: true });
});

beforeEach(async () => {
  resetProcessRateLimiter();
  delete (globalThis as Record<symbol, unknown>)[
    Symbol.for("marketplace.maintenance.refusalLimiter")
  ];
  await writeFile(join(uploadDir, UPLOAD_ROOT_MARKER), "");
  // Back to "never ran", as the migration inserts the row.
  await db.$executeRaw`
    UPDATE "MaintenanceStatus"
       SET "lastSuccessAt" = NULL, "lastRunAt" = NULL, "lastRunOk" = NULL, "updatedAt" = now()
     WHERE "id" = 1`;
});

function maintenance(headers: Record<string, string> = {}): Request {
  return new Request(`${APP_URL}/api/v1/internal/maintenance`, { method: "POST", headers });
}

const AUTHORIZED = { authorization: `Bearer ${CRON_SECRET}` };

const row = () => db.maintenanceStatus.findUniqueOrThrow({ where: { id: 1 } });

/** Sets the last success (and the last run, ok) to `minutes` ago on the database clock. */
async function succeededMinutesAgo(minutes: number): Promise<void> {
  await db.$executeRaw`
    UPDATE "MaintenanceStatus"
       SET "lastSuccessAt" = now() - (${minutes}::int * interval '1 minute'),
           "lastRunAt" = now() - (${minutes}::int * interval '1 minute'),
           "lastRunOk" = true,
           "updatedAt" = now()
     WHERE "id" = 1`;
}

function capture() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: "debug",
    write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  return { lines, logger };
}

/** Lets the status read of a health check and the log decision after it settle. */
async function settled(): Promise<void> {
  for (let round = 0; round < 50; round += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

describe("recording a maintenance run (SEC-100 (b))", () => {
  it("starts as never ran: every column NULL, and the reader says so", async () => {
    expect(await row()).toMatchObject({ lastSuccessAt: null, lastRunAt: null, lastRunOk: null });
    const reading = await readMaintenanceStatus();
    expect(reading).toEqual({
      lastRunAgeSeconds: null,
      lastRunOk: null,
      lastSuccessAgeSeconds: null,
    });
    expect(assessMaintenanceStatus(reading)).toBe("never-ran");
  });

  it("a successful run through the endpoint sets the last run and the last success", async () => {
    const before = await row();
    const response = await POST(maintenance(AUTHORIZED));
    expect(response.status).toBe(200);
    const after = await row();
    expect(after.lastRunOk).toBe(true);
    expect(after.lastRunAt).not.toBeNull();
    expect(after.lastSuccessAt).not.toBeNull();
    expect(after.lastSuccessAt?.getTime()).toBe(after.lastRunAt?.getTime());
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
    // On the database clock, within a few seconds of now.
    const reading = await readMaintenanceStatus();
    expect(reading?.lastSuccessAgeSeconds).toBeLessThanOrEqual(5);
    expect(assessMaintenanceStatus(reading)).toBe("fresh");
    // Still exactly one row.
    expect(await db.maintenanceStatus.count()).toBe(1);
  });

  it("a run with a failed job records the run as not ok and keeps the last success", async () => {
    await succeededMinutesAgo(30);
    const earlier = await row();
    await unlink(join(uploadDir, UPLOAD_ROOT_MARKER));
    const response = await POST(maintenance(AUTHORIZED));
    expect(response.status).toBe(500);
    const after = await row();
    expect(after.lastRunOk).toBe(false);
    expect(after.lastSuccessAt?.getTime()).toBe(earlier.lastSuccessAt?.getTime());
    expect(after.lastRunAt?.getTime()).toBeGreaterThan(earlier.lastRunAt?.getTime() ?? 0);
  });

  it("a refused request records nothing", async () => {
    const before = await row();
    const response = await POST(maintenance({ authorization: "Bearer wrong" }));
    expect(response.status).toBe(401);
    expect(await row()).toEqual(before);
  });

  it("never inserts the row: with the row gone the write updates nothing and the run still answers 200", async () => {
    await db.$executeRaw`DELETE FROM "MaintenanceStatus" WHERE "id" = 1`;
    try {
      expect(await recordMaintenanceRun(true)).toBe(0);
      const response = await POST(maintenance(AUTHORIZED));
      expect(response.status).toBe(200);
      expect(await db.maintenanceStatus.count()).toBe(0);
      expect(await readMaintenanceStatus()).toBeNull();
    } finally {
      await db.$executeRaw`
        INSERT INTO "MaintenanceStatus" ("id", "lastSuccessAt", "lastRunAt", "lastRunOk", "updatedAt")
        VALUES (1, NULL, NULL, NULL, now())`;
    }
  });
});

describe("the health check reads the status (SEC-100 (b))", () => {
  it("never ran: answers up and writes nothing", async () => {
    const { lines, logger } = capture();
    const check = createHealthCheck({ logger });
    expect(await check()).toEqual({ status: "ok", database: "up" });
    await settled();
    expect(lines).toEqual([]);
  });

  it("a success 30 minutes ago is fresh: answers up and writes nothing", async () => {
    await succeededMinutesAgo(30);
    const { lines, logger } = capture();
    const check = createHealthCheck({ logger });
    expect(await check()).toEqual({ status: "ok", database: "up" });
    await settled();
    expect(lines).toEqual([]);
  });

  it("a success 46 minutes ago is stale: one warn line, and the answer is still exactly up", async () => {
    await succeededMinutesAgo(46);
    const { lines, logger } = capture();
    const check = createHealthCheck({ logger, maintenanceReadIntervalMs: 0 });
    const report = await check({ requestId: "req-stale-int-1" });
    expect(report).toEqual({ status: "ok", database: "up" });
    expect(Object.keys(report).sort()).toEqual(["database", "status"]);
    await settled();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "warn",
      component: "health",
      check: "maintenance",
      freshness: "stale",
      staleAfterMinutes: 45,
      lastSuccessAgeMinutes: 46,
      lastRunOk: true,
      requestId: "req-stale-int-1",
    });

    // A run through the endpoint makes it fresh again: the next check writes one info line.
    expect((await POST(maintenance(AUTHORIZED))).status).toBe(200);
    expect(await check()).toEqual({ status: "ok", database: "up" });
    await settled();
    expect(lines.map((line) => line.level)).toEqual(["warn", "info"]);
    expect(lines[1]).toMatchObject({ check: "maintenance", freshness: "fresh" });
  });
});
