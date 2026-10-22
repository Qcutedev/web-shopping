/**
 * GET /api/v1/admin/applications (docs/API_CONTRACTS.md section 5.9.2; REQ-A-03, REQ-N-06).
 * Access `admin`. Paginated (at most 50), oldest first. Filter `status`.
 *
 * Order of checks (section 1.8): 3 the session (401), 4 the role `ADMIN` (403 FORBIDDEN), 7 the
 * query (400), then the service.
 */
import { listApplications, listApplicationsQuerySchema, queryRecord } from "@/modules/admin";
import { requireRole } from "@/server/auth/actor";
import { requireActor } from "@/server/auth/session";
import { paginated, parseInput } from "@/server/http";
import { handleRequest } from "@/server/request-frame";

export async function GET(request: Request): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    const actor = await requireActor(request);
    requireRole(actor, "ADMIN");
    const query = parseInput(
      listApplicationsQuerySchema,
      queryRecord(new URL(request.url).searchParams),
    );
    const page = await listApplications(actor, query);
    return paginated(page.items, page, { requestId });
  });
}
