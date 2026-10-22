/**
 * GET /api/v1/admin/audit-logs (docs/API_CONTRACTS.md section 5.9.7; REQ-A-10, REQ-N-06). Access
 * `admin`. Paginated (at most 50), newest first, read-only. Filters `actorId`, `action`,
 * `targetType`, `targetId`, `from`, `to`. No endpoint edits or deletes an entry.
 *
 * Order of checks (section 1.8): 3 the session (401), 4 the role `ADMIN` (403 FORBIDDEN), 7 the
 * query (400), then the service.
 */
import { listAuditLogs, listAuditLogsQuerySchema, queryRecord } from "@/modules/admin";
import { requireRole } from "@/server/auth/actor";
import { requireActor } from "@/server/auth/session";
import { paginated, parseInput } from "@/server/http";
import { handleRequest } from "@/server/request-frame";

export async function GET(request: Request): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    const actor = await requireActor(request);
    requireRole(actor, "ADMIN");
    const query = parseInput(
      listAuditLogsQuerySchema,
      queryRecord(new URL(request.url).searchParams),
    );
    const page = await listAuditLogs(actor, query);
    return paginated(page.items, page, { requestId });
  });
}
