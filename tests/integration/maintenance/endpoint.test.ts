/**
 * `POST /api/v1/internal/maintenance` against the worker's real test database and a real
 * temporary upload directory (docs/API_CONTRACTS.md section 5.11; owner decision 2026-10-29,
 * D-051). The route module is called in process with a real `Request`; the jobs are the real
 * payment timeout sweep, upload orphan cleanup, and session purge.
 */
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/v1/internal/maintenance/route";
import { generateStorageKey, UPLOAD_ROOT_MARKER } from "@/modules/uploads";
import { db } from "@/server/db";

import { createOrder, createSession, createUpload } from "../../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../../helpers/snapshot";
import { APP_ORIGIN, APP_URL, resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import { signedIn } from "../sellers/support";

// Generated per run, never written in the repository.
const CRON_SECRET = randomBytes(32).toString("base64url");
const HOUR_MS = 60 * 60 * 1_000;

let uploadDir: string;

beforeAll(async () => {
  stubAuthEnvironment();
  process.env["CRON_SECRET"] = CRON_SECRET;
  delete process.env["MAINTENANCE_VIA_HTTP"];
  uploadDir = await mkdtemp(join(tmpdir(), "maintenance-uploads-"));
  process.env["UPLOAD_DIR"] = uploadDir;
});

afterAll(async () => {
  delete process.env["CRON_SECRET"];
  delete process.env["UPLOAD_DIR"];
  await rm(uploadDir, { recursive: true, force: true });
});

beforeEach(async () => {
  resetProcessRateLimiter();
  // The SEC-073 marker: a root without it is "not ready" and the cleanup deletes nothing.
  await writeFile(join(uploadDir, UPLOAD_ROOT_MARKER), "");
});

function maintenance(headers: Record<string, string> = {}): Request {
  return new Request(`${APP_URL}/api/v1/internal/maintenance`, { method: "POST", headers });
}

const AUTHORIZED = { authorization: `Bearer ${CRON_SECRET}` };

/** An unpaid order created two hours ago, an expired session, and an orphan two days old. */
async function staleState() {
  const { order } = await createOrder({
    paymentStatus: "PENDING",
    createdAt: new Date(Date.now() - 2 * HOUR_MS),
  });
  const session = await createSession({ expiresAt: new Date(Date.now() - HOUR_MS) });
  // A real stored file where the local disk adapter keeps it: <root>/<first two digits>/<key>.
  const storageKey = generateStorageKey();
  await mkdir(join(uploadDir, storageKey.slice(0, 2)), { recursive: true });
  await writeFile(join(uploadDir, storageKey.slice(0, 2), storageKey), "x");
  const orphan = await createUpload({
    storageKey,
    sizeBytes: 1,
    createdAt: new Date(Date.now() - 48 * HOUR_MS),
  });
  return { order, session, orphan };
}

async function expect401(response: Response): Promise<void> {
  expect(response.status).toBe(401);
  const body = (await response.json()) as { error: Record<string, unknown> };
  expect(body.error).toMatchObject({
    code: "UNAUTHENTICATED",
    message: "Authentication is required.",
    details: {},
  });
}

describe("POST /api/v1/internal/maintenance", () => {
  it("runs the three jobs with the right secret and answers counts", async () => {
    const { order, session, orphan } = await staleState();
    const response = await POST(maintenance(AUTHORIZED));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { data: Record<string, unknown> };
    expect(body).toEqual({
      data: {
        ok: true,
        jobs: {
          paymentTimeoutSweep: { ok: true, found: 1, failed: 1, errored: 0 },
          uploadCleanup: {
            ok: true,
            rowsDeleted: 1,
            filesDeleted: 1,
            filesMissing: 0,
            filesFailed: 0,
          },
          sessionPurge: { ok: true, removedSessions: 1, removedVerifications: 0 },
        },
      },
    });
    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.paymentStatus).toBe("FAILED");
    expect(await db.session.count({ where: { id: session.id } })).toBe(0);
    expect(await db.upload.count({ where: { id: orphan.id } })).toBe(0);
  });

  it("answers 401 without the header, with a wrong secret, and changes nothing", async () => {
    await staleState();
    const before = await snapshotDatabase();
    await expect401(await POST(maintenance()));
    await expect401(await POST(maintenance({ authorization: `Bearer ${CRON_SECRET}x` })));
    await expect401(await POST(maintenance({ authorization: "Bearer " })));
    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([]);
  });

  it("ignores a real session: an admin's or a customer's cookie never authorizes it", async () => {
    await staleState();
    const admin = await signedIn("ADMIN");
    const customer = await signedIn("CUSTOMER");
    const before = await snapshotDatabase();
    for (const user of [admin, customer]) {
      await expect401(await POST(maintenance({ cookie: user.cookie })));
      await expect401(
        await POST(maintenance({ cookie: user.cookie, origin: APP_ORIGIN, ...AUTHORIZED })),
      );
      await expect401(await POST(maintenance({ ...AUTHORIZED, cookie: user.cookie })));
    }
    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([]);
  });

  it("isolates a failed job: storage not ready gives 500, the other jobs still ran", async () => {
    const { order, session, orphan } = await staleState();
    await unlink(join(uploadDir, UPLOAD_ROOT_MARKER));
    const response = await POST(maintenance(AUTHORIZED));
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: Record<string, unknown> };
    expect(body.error).toMatchObject({
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
      details: {},
    });
    expect(JSON.stringify(body)).not.toContain(uploadDir);
    // SEC-073: no row deleted while the storage is not ready.
    expect(await db.upload.count({ where: { id: orphan.id } })).toBe(1);
    // The other two jobs did their work.
    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.paymentStatus).toBe("FAILED");
    expect(await db.session.count({ where: { id: session.id } })).toBe(0);
  });

  it("is safe when two calls overlap: the order is failed once", async () => {
    const { order } = await staleState();
    const [one, two] = await Promise.all([
      POST(maintenance(AUTHORIZED)),
      POST(maintenance(AUTHORIZED)),
    ]);
    expect([one.status, two.status]).toEqual([200, 200]);
    const [first, second] = (await Promise.all([one.json(), two.json()])) as {
      data: { jobs: { paymentTimeoutSweep: { ok: boolean; failed: number; errored: number } } };
    }[];
    // One process shares one run between the two requests, so both carry the same report.
    expect(second).toEqual(first);
    expect(first?.data.jobs.paymentTimeoutSweep).toMatchObject({ ok: true, errored: 0 });
    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.paymentStatus).toBe("FAILED");
    const payment = await db.payment.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(payment.failureReason).toBe("TIMEOUT");
  });
});
