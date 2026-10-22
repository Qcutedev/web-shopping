/**
 * GET /api/v1/admin/summary (docs/API_CONTRACTS.md section 5.9.7; REQ-A-01, BR-33, D-028). Access
 * `admin`. The four groups of dashboard figures, over all time, from real rows.
 *
 * Order of checks (section 1.8): 3 the session (401), 4 the role `ADMIN` (403 FORBIDDEN), then
 * the service. The query is not read.
 */
import { getSummary } from "@/modules/admin";
import { requireRole } from "@/server/auth/actor";
import { requireActor } from "@/server/auth/session";
import { ok } from "@/server/http";
import { handleRequest } from "@/server/request-frame";

export async function GET(request: Request): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    const actor = await requireActor(request);
    requireRole(actor, "ADMIN");
    return ok(await getSummary(actor), { requestId });
  });
}
