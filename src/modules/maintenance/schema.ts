/**
 * Contract of `POST /api/v1/internal/maintenance` (docs/API_CONTRACTS.md section 5.11). The
 * response holds counts and per-job outcomes only: no id, no key, no error text.
 */
import { z } from "zod";

/** The path of the endpoint, for the scheduler's configuration and for tests. */
export const MAINTENANCE_PATH = "/api/v1/internal/maintenance";

/** The jobs, in the order they run. */
export const MAINTENANCE_JOBS = ["paymentTimeoutSweep", "uploadCleanup", "sessionPurge"] as const;
export type MaintenanceJobName = (typeof MAINTENANCE_JOBS)[number];

const count = z.number().int().nonnegative();
const failedJob = z.strictObject({ ok: z.literal(false) });

export const paymentTimeoutSweepOutcomeSchema = z.union([
  z.strictObject({ ok: z.literal(true), found: count, failed: count, errored: count }),
  failedJob,
]);

export const uploadCleanupOutcomeSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    rowsDeleted: count,
    filesDeleted: count,
    filesMissing: count,
    filesFailed: count,
  }),
  failedJob,
]);

export const sessionPurgeOutcomeSchema = z.union([
  z.strictObject({ ok: z.literal(true), removedSessions: count, removedVerifications: count }),
  failedJob,
]);

/** `data` of a `200` response: every job ran and succeeded (`ok` is then always true). */
export const maintenanceReportSchema = z.strictObject({
  ok: z.boolean(),
  jobs: z.strictObject({
    paymentTimeoutSweep: paymentTimeoutSweepOutcomeSchema,
    uploadCleanup: uploadCleanupOutcomeSchema,
    sessionPurge: sessionPurgeOutcomeSchema,
  }),
});

export type PaymentTimeoutSweepOutcome = z.infer<typeof paymentTimeoutSweepOutcomeSchema>;
export type UploadCleanupOutcome = z.infer<typeof uploadCleanupOutcomeSchema>;
export type SessionPurgeOutcome = z.infer<typeof sessionPurgeOutcomeSchema>;
export type MaintenanceReport = z.infer<typeof maintenanceReportSchema>;
