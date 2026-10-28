/**
 * GET /api/v1/admin/reviews (docs/API_CONTRACTS.md section 5.9.9; SECURITY.md SEC-092). Access
 * `admin`. Paginated (at most 50), newest first, hidden reviews included. Filters `productId`,
 * `hidden`.
 *
 * Order of checks (section 1.8): 3 the session (401), 4 the role `ADMIN` (403 FORBIDDEN), 7 the
 * query (400), then the service.
 */
import { listReviews, listReviewsQuerySchema, queryRecord } from "@/modules/admin";
import { requireRole } from "@/server/auth/actor";
import { requireActor } from "@/server/auth/session";
import { paginated, parseInput } from "@/server/http";
import { handleRequest } from "@/server/request-frame";

export async function GET(request: Request): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    const actor = await requireActor(request);
    requireRole(actor, "ADMIN");
    const query = parseInput(
      listReviewsQuerySchema,
      queryRecord(new URL(request.url).searchParams),
    );
    const page = await listReviews(actor, query);
    return paginated(page.items, page, { requestId });
  });
}
