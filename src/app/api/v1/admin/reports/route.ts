/**
 * GET /api/v1/admin/reports (docs/API_CONTRACTS.md section 5.9.7; REQ-A-08, BR-33, D-028).
 * Access `admin`. Query `from` and `to`, both required, instants with an offset, `from` earlier
 * than `to`. Orders and revenue are placed by the paid time.
 *
 * Order of checks (section 1.8): 3 the session (401), 4 the role `ADMIN` (403 FORBIDDEN), 7 the
 * query (400), then the service.
 */
import { getReport, queryRecord, reportQuerySchema } from "@/modules/admin";
import { requireRole } from "@/server/auth/actor";
import { requireActor } from "@/server/auth/session";
import { ok, parseInput } from "@/server/http";
import { handleRequest } from "@/server/request-frame";

export async function GET(request: Request): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    const actor = await requireActor(request);
    requireRole(actor, "ADMIN");
    const query = parseInput(reportQuerySchema, queryRecord(new URL(request.url).searchParams));
    return ok(await getReport(actor, query), { requestId });
  });
}
