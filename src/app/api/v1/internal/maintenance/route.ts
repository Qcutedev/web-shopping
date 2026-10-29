/**
 * POST /api/v1/internal/maintenance (docs/API_CONTRACTS.md section 5.11; owner decision
 * 2026-10-29, D-051). Machine to machine: a scheduler (GitHub Actions cron, every 10 minutes)
 * runs the payment timeout sweep, the upload orphan cleanup, and the expired session purge on a
 * host where the in-process timers cannot run.
 *
 * Order of checks: the bearer secret (`Authorization: Bearer <CRON_SECRET>`, compared in constant
 * time; no secret configured, no or a wrong header, or a `Cookie` or `Origin` header: `401`, the
 * same answer each time), then the service. No session is read and no cookie is looked at, so a
 * browser gets nothing from its session. No `Origin` or `Content-Type` check (section 1.2 does
 * not apply): the bearer header, which a browser cannot send cross-site without a CORS preflight
 * this application never answers, is the CSRF control. The body is never read.
 *
 * `200` with counts when every job succeeded; `500 INTERNAL_ERROR` (fixed text, nothing else)
 * when at least one failed, so a scheduler that fails on a non-2xx status reports it. The jobs
 * that succeeded have done their work either way; each job's own log line says which failed.
 */
import {
  isAuthorizedMaintenanceRequest,
  type MaintenanceReport,
  runMaintenanceOnce,
} from "@/modules/maintenance";
import { getEnv } from "@/server/env";
import { internalError, unauthenticated } from "@/server/errors";
import { ok } from "@/server/http";
import { createMaintenanceJobs } from "@/server/maintenance-jobs";
import { handleRequest } from "@/server/request-frame";

/** Seconds a platform may let one run take (the cleanup is bounded to 1,000 rows per run). */
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleRequest(request, async ({ requestId, log }) => {
    const env = getEnv();
    if (!isAuthorizedMaintenanceRequest(request.headers, env.cronSecret)) {
      // Nothing of the request is logged: not the header, not whether it was present.
      log.warn("Maintenance request refused", { component: "maintenance" });
      throw unauthenticated();
    }
    const report: MaintenanceReport = await runMaintenanceOnce(
      createMaintenanceJobs({ paymentTimeoutMinutes: env.paymentTimeoutMinutes }),
      log,
    );
    if (!report.ok) throw internalError();
    return ok(report, { requestId });
  });
}
