/**
 * Overlap of maintenance runs across instances (D-051 review, "Not reviewed / residual risks":
 * the overlap safety of the three jobs under concurrent runs across instances was reasoned, not
 * tested). `runMaintenanceOnce` shares one run per process, so it cannot show what two instances
 * do. Here several runs of `runMaintenance` (no per-process sharing) are started at the same
 * moment against the worker's real test database, each on its own pooled connection, next to one
 * request through the route, as several serverless instances and a timer of a long-lived host
 * would be. The jobs are the real ones (`createMaintenanceJobs`).
 *
 * Expected, from src/modules/maintenance/service.ts "Overlap": every overdue order is failed
 * exactly once and its stock restored exactly once (guarded failure transaction); every orphan
 * upload row and file is deleted by exactly one run (`FOR UPDATE ... SKIP LOCKED`); every expired
 * session is removed once (`deleteMany`); no run reports an error.
 */
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/v1/internal/maintenance/route";
import { type MaintenanceReport, runMaintenance } from "@/modules/maintenance";
import { generateStorageKey, UPLOAD_ROOT_MARKER } from "@/modules/uploads";
import { db } from "@/server/db";
import { createMaintenanceJobs } from "@/server/maintenance-jobs";

import {
  createOrder,
  createProduct,
  createSession,
  createStore,
  createUpload,
} from "../../helpers/factories";
import { APP_URL, resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";

// Generated per run, never written in the repository.
const CRON_SECRET = randomBytes(32).toString("base64url");
const HOUR_MS = 60 * 60 * 1_000;
/** Runs started at once without the per-process sharing: one per simulated instance. */
const INSTANCES = 4;
const ORDERS = 6;
const ORPHANS = 8;
const EXPIRED_SESSIONS = 5;

let uploadDir: string;

beforeAll(async () => {
  stubAuthEnvironment();
  process.env["CRON_SECRET"] = CRON_SECRET;
  delete process.env["MAINTENANCE_VIA_HTTP"];
  uploadDir = await mkdtemp(join(tmpdir(), "maintenance-overlap-"));
  process.env["UPLOAD_DIR"] = uploadDir;
});

afterAll(async () => {
  delete process.env["CRON_SECRET"];
  delete process.env["UPLOAD_DIR"];
  await rm(uploadDir, { recursive: true, force: true });
});

beforeEach(async () => {
  resetProcessRateLimiter();
  await writeFile(join(uploadDir, UPLOAD_ROOT_MARKER), "");
});

const silentLog = { info: () => undefined, error: () => undefined };

async function storedFiles(): Promise<number> {
  let count = 0;
  for (const entry of await readdir(uploadDir, { withFileTypes: true })) {
    if (entry.isDirectory()) count += (await readdir(join(uploadDir, entry.name))).length;
  }
  return count;
}

describe("maintenance runs overlapping across instances", () => {
  it("fails each overdue order once, restores its stock once, and deletes each orphan and session once", async () => {
    // One product shared by every order, so the stock restores contend for one row.
    const store = await createStore();
    const product = await createProduct({ storeId: store.id, stock: 50 });
    const orders = [];
    for (let index = 0; index < ORDERS; index += 1) {
      const { order } = await createOrder({
        paymentStatus: "PENDING",
        createdAt: new Date(Date.now() - 2 * HOUR_MS),
        lines: [{ productId: product.id, quantity: 2 }],
      });
      orders.push(order);
    }
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(
      50 - 2 * ORDERS,
    );

    for (let index = 0; index < EXPIRED_SESSIONS; index += 1) {
      await createSession({ expiresAt: new Date(Date.now() - HOUR_MS) });
    }
    const live = await createSession({ expiresAt: new Date(Date.now() + HOUR_MS) });

    for (let index = 0; index < ORPHANS; index += 1) {
      const storageKey = generateStorageKey();
      await mkdir(join(uploadDir, storageKey.slice(0, 2)), { recursive: true });
      await writeFile(join(uploadDir, storageKey.slice(0, 2), storageKey), "x");
      await createUpload({
        storageKey,
        sizeBytes: 1,
        createdAt: new Date(Date.now() - 48 * HOUR_MS),
      });
    }
    expect(await storedFiles()).toBe(ORPHANS);

    const jobs = () => createMaintenanceJobs({ paymentTimeoutMinutes: 15 });
    const [response, ...direct] = await Promise.all([
      POST(
        new Request(`${APP_URL}/api/v1/internal/maintenance`, {
          method: "POST",
          headers: { authorization: `Bearer ${CRON_SECRET}` },
        }),
      ),
      ...Array.from({ length: INSTANCES }, () => runMaintenance(jobs(), silentLog)),
    ]);
    expect(response?.status).toBe(200);
    const viaRoute = ((await response?.json()) as { data: MaintenanceReport }).data;
    const reports: MaintenanceReport[] = [viaRoute, ...direct];

    // No run failed, and no job reported an error.
    for (const report of reports) {
      expect(report.ok).toBe(true);
      const { paymentTimeoutSweep, uploadCleanup } = report.jobs;
      expect(paymentTimeoutSweep).toMatchObject({ ok: true, errored: 0 });
      expect(uploadCleanup).toMatchObject({ ok: true, filesFailed: 0 });
    }

    const sum = (pick: (report: MaintenanceReport) => number): number =>
      reports.reduce((total, report) => total + pick(report), 0);
    const sweep = (report: MaintenanceReport) =>
      report.jobs.paymentTimeoutSweep.ok ? report.jobs.paymentTimeoutSweep : undefined;
    const cleanup = (report: MaintenanceReport) =>
      report.jobs.uploadCleanup.ok ? report.jobs.uploadCleanup : undefined;
    const purge = (report: MaintenanceReport) =>
      report.jobs.sessionPurge.ok ? report.jobs.sessionPurge : undefined;

    // Across all runs together: each order failed by exactly one, each row deleted by one.
    expect(sum((report) => sweep(report)?.failed ?? 0)).toBe(ORDERS);
    expect(sum((report) => cleanup(report)?.rowsDeleted ?? 0)).toBe(ORPHANS);
    expect(sum((report) => cleanup(report)?.filesDeleted ?? 0)).toBe(ORPHANS);
    expect(sum((report) => cleanup(report)?.filesMissing ?? 0)).toBe(0);
    expect(sum((report) => purge(report)?.removedSessions ?? 0)).toBe(EXPIRED_SESSIONS);

    // The database agrees.
    for (const order of orders) {
      const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(after.paymentStatus).toBe("FAILED");
      const payment = await db.payment.findUniqueOrThrow({ where: { orderId: order.id } });
      expect(payment.failureReason).toBe("TIMEOUT");
    }
    // Stock restored exactly once per item: back to where it started, not above.
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(50);
    const items = await db.orderItem.findMany({
      where: { sellerOrder: { orderId: { in: orders.map((order) => order.id) } } },
    });
    expect(items).toHaveLength(ORDERS);
    expect(items.every((item) => item.stockRestoredAt !== null)).toBe(true);

    expect(await db.upload.count()).toBe(0);
    expect(await storedFiles()).toBe(0);
    expect(await db.session.count({ where: { expiresAt: { lt: new Date() } } })).toBe(0);
    expect(await db.session.count({ where: { id: live.id } })).toBe(1);
  });
});
