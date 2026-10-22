/**
 * GET /api/v1/admin/products (docs/API_CONTRACTS.md section 5.9.3; REQ-A-05, BR-36, REQ-N-06).
 * Access `admin`. Paginated (at most 50). `queue=true` is the approval queue, oldest submission
 * first; other filters `moderationStatus`, `status`, `storeId`, `q`.
 *
 * Order of checks (section 1.8): 3 the session (401), 4 the role `ADMIN` (403 FORBIDDEN), 7 the
 * query (400), then the service.
 */
import { listProducts, listProductsQuerySchema, queryRecord } from "@/modules/admin";
import { requireRole } from "@/server/auth/actor";
import { requireActor } from "@/server/auth/session";
import { paginated, parseInput } from "@/server/http";
import { handleRequest } from "@/server/request-frame";

export async function GET(request: Request): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    const actor = await requireActor(request);
    requireRole(actor, "ADMIN");
    const query = parseInput(
      listProductsQuerySchema,
      queryRecord(new URL(request.url).searchParams),
    );
    const page = await listProducts(actor, query);
    return paginated(page.items, page, { requestId });
  });
}
